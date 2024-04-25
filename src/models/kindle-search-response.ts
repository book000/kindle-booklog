export interface KindleBook {
  asin: string
  webReaderUrl: string
  productUrl: string
  title: string
  percentageRead: number
  authors: string[]
  resourceType: string
  originType: string
  mangaOrComicAsin: boolean
}

export interface KindleSearchResponse {
  itemsList: KindleBook[]
  paginationToken?: string
  libraryType: string
  sortType: string
}
