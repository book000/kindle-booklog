#!/bin/bash
cd "$(dirname "$0")" || exit 1
BASEDIR="$(dirname "$0")"

sed -i -e "s#%WorkingDirectory%#${BASEDIR}#" ./*.service
sudo cp -v ./*.service /etc/systemd/system/
sudo cp -v ./*.timer /etc/systemd/system/
find . -maxdepth 1 -name '*.timer' | awk '{print $9}' | xargs sudo systemctl enable
find . -maxdepth 1 -name '*.timer' | awk '{print $9}' | xargs sudo systemctl start