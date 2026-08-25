# Board artwork

Tactics Journal created and owns the artwork in this directory. The non-trademark artwork is distributed under the repository's MIT license.

The `brand/` files and Tactics Journal marks embedded in pitch artwork are reserved under [`TRADEMARKS.md`](../TRADEMARKS.md). The diagrams in `examples/pitch/` are original Tactics Journal examples, not broadcast screenshots.

Master artwork lives in the format used by the editor. Browser-sized copies are in `web/` and described by `manifest.json`. Regenerate those copies after changing a master:

```bash
python3 scripts/build-web-assets.py
```

Keep transparent padding small around icons and player markers. Use clear names when adding pitch styles.
