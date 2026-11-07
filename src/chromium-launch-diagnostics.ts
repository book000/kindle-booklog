import childProcess, { type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import { promisify } from 'node:util'

const execFile = promisify(childProcess.execFile)

export const CHROMIUM_SINGLETON_LOCK_FILES = [
  'SingletonLock',
  'SingletonCookie',
  'SingletonSocket',
] as const

export const STDERR_CAPTURE_MAX_BYTES = 64 * 1024
export const STDERR_TAIL_CHARS = 8192
export const VERSION_TIMEOUT_MS = 3000
export const FINAL_EXIT_WAIT_MS = 6000

/**
 * `scheme://user:pass@host` 形式の認証情報を `scheme://***@host` に置き換える
 *
 * @param text 対象の文字列
 * @returns 認証情報を伏せた文字列
 */
export function redactCredentials(text: string): string {
  // スキーム長に上限を置く。無制限だと長い英数字の連続で正規表現が二乗時間になる
  return text.replaceAll(/([a-z][a-z0-9+.-]{0,31}:\/\/)[^/\s@]+@/gi, '$1***@')
}

/**
 * 任意の例外値を、認証情報を伏せた name / message に整形する
 *
 * @param error 投げられた値。Error 以外は name を NonError とする
 * @returns 秘匿済みの name と message
 */
function describeError(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? {
        name: redactCredentials(error.name),
        message: redactCredentials(error.message),
      }
    : { name: 'NonError', message: redactCredentials(String(error)) }
}

export type ChromiumProcessSampleLabel =
  'timeout' | 'rejection' | 'retry-start' | 'final'

/** Chromium プロセスのある時点の状態 */
export interface ChromiumProcessSample {
  label: ChromiumProcessSampleLabel
  /** spawn からの経過ミリ秒 */
  msSinceSpawn: number
  alive: boolean
  exitCode: number | null
  signal: string | null
}

export type ChromiumFailureKind =
  'spawn-error' | 'startup-timeout' | 'signal' | 'early-exit' | 'unknown'

/** Chromium 起動時点の環境(DISPLAY・X11 ソケット・Singleton* の有無) */
export interface ChromiumLaunchEnvironment {
  /** process.env.DISPLAY。空文字は空文字のまま保持する */
  display: string | null
  /** DISPLAY が falsy(未設定・空文字)の場合は null */
  x11Socket: { path: string; exists: boolean } | null
  singletonFiles: Record<string, boolean>
}

/** 起動 1 回分の診断レポート。args・stderrTail・error は秘匿済み */
export interface ChromiumLaunchAttemptReport {
  /** 1 始まりの試行番号 */
  attempt: number
  executablePath: string
  userDataDir: string
  timeoutMs: number
  headless: boolean | 'shell'
  args: string[]
  processCaptured: boolean
  pid: number | null
  samples: ChromiumProcessSample[]
  stderrTail: string
  stderrTruncated: boolean
  /** 取得失敗時は `unavailable: <message>` */
  chromiumVersion: string
  environment: ChromiumLaunchEnvironment
  error: { name: string; message: string }
  failureKind: ChromiumFailureKind
}

/** 診断レポートの作成に、観測結果以外で必要な情報。executablePath と timeoutMs は観測側が持つ */
export interface ChromiumLaunchReportContext {
  attempt: number
  userDataDir: string
  headless: boolean | 'shell'
  /** 未秘匿。buildReport が秘匿する */
  args: string[]
  /** その試行の開始時点で収集したもの */
  environment: ChromiumLaunchEnvironment
  chromiumVersion: string
  error: unknown
}

/** 失敗した起動 1 回分の観測結果。起動した子プロセスの状態・stderr から診断レポートを作る */
export interface ChromiumLaunchCapture {
  readonly processCaptured: boolean
  sample(label: 'retry-start' | 'final'): void
  /**
   * 子プロセスの終了(stderr の読み切りを含む)を最大 maxMs 待つ
   *
   * 子プロセスを観測していない場合、または終了済みの場合は即座に戻る
   */
  waitForExit(maxMs: number): Promise<void>
  stderr(): { text: string; truncated: boolean }
  buildReport(context: ChromiumLaunchReportContext): ChromiumLaunchAttemptReport
}

/** 観測対象の実行ファイルと、timeout サンプルを採取するまでの時間 */
interface CaptureOptions {
  executablePath: string
  timeoutMs: number
}

let capturing = false

/** spawn された Chromium の ChildProcess を観測し、状態と stderr を記録する */
class ChildRecorder {
  private child: ChildProcess | null = null
  private spawnedAt = 0
  private exited = false
  private exitCode: number | null = null
  private signal: string | null = null
  private spawnFailed = false
  private closed = false
  private timer: NodeJS.Timeout | undefined
  private chunks: Buffer[] = []
  private bytes = 0
  private truncated = false
  private readonly samples: ChromiumProcessSample[] = []
  private readonly closeWaiters: (() => void)[] = []

  constructor(private readonly options: CaptureOptions) {}

  get captured(): boolean {
    return this.child !== null
  }

  /**
   * 子プロセスの観測を始める。2 つ目以降の子プロセスは無視する
   *
   * @param child 観測する子プロセス
   */
  attach(child: ChildProcess) {
    // 起動は 1 回の launch につき 1 プロセスのみ想定。2 つ目以降は無視する
    if (this.child) {
      return
    }
    this.child = child
    this.spawnedAt = Date.now()
    child.stderr?.on('data', this.onData)
    child.on('exit', this.onExit)
    child.on('error', this.onError)
    child.on('close', this.onClose)
    this.timer = setTimeout(() => {
      this.sample('timeout')
    }, this.options.timeoutMs)
    this.timer.unref()
  }

  /** launch が settle したので、timeout サンプル用のタイマーを止める */
  stopTimer() {
    clearTimeout(this.timer)
  }

  /** launch 成功時: 子プロセスは生かしたまま、取り付けたリスナーを外す */
  release() {
    this.stopTimer()
    if (!this.child) {
      return
    }
    this.child.stderr?.off('data', this.onData)
    this.child.off('exit', this.onExit)
    this.child.off('error', this.onError)
    this.child.off('close', this.onClose)
  }

  /**
   * 子プロセスの現在の状態を記録する。子プロセスを観測していない場合は何もしない
   *
   * @param label サンプルを採取した契機
   */
  sample(label: ChromiumProcessSampleLabel) {
    if (!this.child) {
      return
    }
    this.samples.push({
      label,
      msSinceSpawn: Date.now() - this.spawnedAt,
      alive: this.child.pid !== undefined && !this.exited,
      exitCode: this.exitCode,
      signal: this.signal,
    })
  }

  waitForExit(maxMs: number): Promise<void> {
    if (!this.child || this.closed) {
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve()
      }, maxMs)
      this.closeWaiters.push(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  stderr(): { text: string; truncated: boolean } {
    return {
      text: redactCredentials(Buffer.concat(this.chunks).toString('utf8')),
      truncated: this.truncated,
    }
  }

  buildReport(
    context: ChromiumLaunchReportContext
  ): ChromiumLaunchAttemptReport {
    const { text, truncated } = this.stderr()
    return {
      attempt: context.attempt,
      executablePath: this.options.executablePath,
      userDataDir: context.userDataDir,
      timeoutMs: this.options.timeoutMs,
      headless: context.headless,
      args: context.args.map((argument) => redactCredentials(argument)),
      processCaptured: this.captured,
      pid: this.child?.pid ?? null,
      samples: [...this.samples],
      stderrTail: text.slice(-STDERR_TAIL_CHARS),
      stderrTruncated: truncated,
      chromiumVersion: context.chromiumVersion,
      environment: context.environment,
      error: describeError(context.error),
      failureKind: this.classify(),
    }
  }

  /**
   * 失敗の種類を判定する
   *
   * timeout 後は puppeteer 自身が SIGKILL を送るため、signal より先に
   * startup-timeout を判定する
   */
  private classify(): ChromiumFailureKind {
    if (!this.child) {
      return 'unknown'
    }
    if (this.child.pid === undefined || this.spawnFailed) {
      return 'spawn-error'
    }
    if (this.samples.some((item) => item.label === 'timeout' && item.alive)) {
      return 'startup-timeout'
    }
    if (this.samples.some((item) => item.signal !== null)) {
      return 'signal'
    }
    if (this.samples.some((item) => item.exitCode !== null)) {
      return 'early-exit'
    }
    return 'unknown'
  }

  private readonly onData = (chunk: Buffer | string) => {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    this.chunks.push(buffer)
    this.bytes += buffer.length
    while (this.bytes > STDERR_CAPTURE_MAX_BYTES) {
      this.truncated = true
      const excess = this.bytes - STDERR_CAPTURE_MAX_BYTES
      const first = this.chunks[0]
      if (first.length <= excess) {
        this.chunks.shift()
        this.bytes -= first.length
      } else {
        this.chunks[0] = first.subarray(excess)
        this.bytes -= excess
      }
    }
  }

  private readonly onExit = (code: number | null, signal: string | null) => {
    this.exited = true
    this.exitCode = code
    this.signal = signal
  }

  private readonly onError = () => {
    this.spawnFailed = true
    this.markClosed()
  }

  private readonly onClose = () => {
    this.markClosed()
  }

  private markClosed() {
    this.closed = true
    for (const waiter of this.closeWaiters.splice(0)) {
      waiter()
    }
  }
}

/**
 * Chromium の起動 1 回分を包み、起動したプロセスの状態と stderr を記録する
 *
 * 包んでいる間だけ child_process.spawn を差し替え、executablePath と一致する
 * 呼び出しの ChildProcess を観測する。puppeteer は起動失敗時に Process を
 * 公開しないため、spawn の差し替えで観測する。launch の結果(値・例外)は
 * 変えない。同時に 2 つは実行できない。
 *
 * @param options 起動する実行ファイルと、puppeteer に渡す起動 timeout
 * @param launch puppeteer.launch を呼ぶ関数
 * @returns 成功時は launch の値、失敗時は launch の例外と観測結果
 */
export async function captureChromiumLaunch<T>(
  options: CaptureOptions,
  launch: () => Promise<T>
): Promise<
  | { ok: true; value: T }
  | { ok: false; error: unknown; capture: ChromiumLaunchCapture }
> {
  if (capturing) {
    throw new Error('captureChromiumLaunch is already running')
  }
  capturing = true

  const originalSpawn = childProcess.spawn
  const recorder = new ChildRecorder(options)
  Reflect.set(
    childProcess,
    'spawn',
    function patchedSpawn(this: unknown, ...args: unknown[]) {
      const child = Reflect.apply(originalSpawn, this, args) as ChildProcess
      if (args[0] === options.executablePath) {
        try {
          recorder.attach(child)
        } catch (error) {
          process.emitWarning(
            `Failed to attach Chromium launch capture: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
      return child
    }
  )

  try {
    const value = await launch()
    recorder.release()
    return { ok: true, value }
  } catch (error) {
    recorder.stopTimer()
    recorder.sample('rejection')
    return {
      ok: false,
      error,
      capture: {
        get processCaptured() {
          return recorder.captured
        },
        sample: (label) => {
          recorder.sample(label)
        },
        waitForExit: (maxMs) => recorder.waitForExit(maxMs),
        stderr: () => recorder.stderr(),
        buildReport: (context) => recorder.buildReport(context),
      },
    }
  } finally {
    Reflect.set(childProcess, 'spawn', originalSpawn)
    capturing = false
  }
}

/**
 * 実際に起動される Chromium のバージョンを取得する
 *
 * 取得に失敗・timeout した場合も例外にせず、`unavailable: <message>` を返す
 *
 * @param executablePath Chromium の実行ファイル
 * @param timeoutMs 実行の timeout(ミリ秒)
 * @returns `--version` の出力、または `unavailable: <message>`
 */
export async function readChromiumVersion(
  executablePath: string,
  timeoutMs: number
): Promise<string> {
  try {
    const { stdout } = await execFile(executablePath, ['--version'], {
      timeout: timeoutMs,
      encoding: 'utf8',
    })
    return stdout.trim()
  } catch (error) {
    return `unavailable: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * Chromium の起動環境(DISPLAY・X11 ソケット・Singleton* の有無)を収集する
 *
 * @param userDataDir Chromium の userDataDir パス
 * @returns 収集した起動環境
 */
export function collectChromiumLaunchEnvironment(
  userDataDir: string
): ChromiumLaunchEnvironment {
  const display = process.env.DISPLAY ?? null

  let x11Socket: ChromiumLaunchEnvironment['x11Socket'] = null
  if (display) {
    // entrypoint.sh と同じ規則で X11 ソケットパスを組み立てる(":99" -> "X99")
    const displayNumber = display.replace(/^:/, '').split('.', 1)[0]
    const socketPath = `/tmp/.X11-unix/X${displayNumber}`
    x11Socket = { path: socketPath, exists: fs.existsSync(socketPath) }
  }

  const singletonFiles: Record<string, boolean> = {}
  for (const lockFile of CHROMIUM_SINGLETON_LOCK_FILES) {
    singletonFiles[lockFile] = fs.existsSync(`${userDataDir}/${lockFile}`)
  }

  return { display, x11Socket, singletonFiles }
}

/** 2 回の起動がどちらも失敗したことを表すエラー。各試行の診断レポートを保持する */
export class ChromiumLaunchError extends Error {
  readonly attempts: ChromiumLaunchAttemptReport[]

  constructor(
    message: string,
    options: { cause: unknown; attempts: ChromiumLaunchAttemptReport[] }
  ) {
    super(message, { cause: options.cause })
    this.attempts = options.attempts
  }
}
