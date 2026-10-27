# Polymarket BTC Live Extension

A read-only Chrome Manifest V3 extension that adds a local BTC chart to
Polymarket's five-minute BTC Up/Down market page.

Current version: **1.3.6**

- Shows Up, Down and BTC on the same rolling 60-second timeline.
- Shows the current BTC distance above or below the round target price.
- Includes 60-second, 5-minute and 15-minute BTC views.
- Uses smooth, monotone curves without averaging the source prices.
- Preserves data gaps instead of fabricating missing samples.
- Does not connect to wallets, place orders or collect account data.

The extension expects a compatible local event stream at
`http://127.0.0.1:8765/events`. The local data service is not included in this
repository.

See the [Chinese installation and usage guide](README-安装说明.md) for details.

## Test

```sh
node --test test_protocol.mjs
```

## License

[MIT](LICENSE)
