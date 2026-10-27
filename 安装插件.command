#!/bin/zsh
set -e
extension_dir="${0:A:h}"
/usr/bin/open -a "Google Chrome" "chrome://extensions/"
/usr/bin/open "$extension_dir"
cat <<'TEXT'
已打开 Chrome 扩展程序页面和插件文件夹。

请在 Chrome 中：
1. 打开右上角“开发者模式”。
2. 点击“加载已解压的扩展程序”。
3. 选择刚打开的 polymarket-live-extension 文件夹。
4. 刷新官网 BTC 5分钟市场页面。

如显示本机服务未连接，请先启动 btc5m-live 中的“打开页面.command”。

插件文件夹：
TEXT
print -r -- "$extension_dir"
read -r "?按回车关闭此窗口。"
