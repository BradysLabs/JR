# Worth scraper

Reads the [Animal Jam Item Worth Wiki](https://aj-item-worth.fandom.com) and writes `values.json`
for JR's Trading page: one entry per item and per color column, with its picture, grade,
trade offers and the date the wiki page was last updated.

No install needed, just Node 18 or newer.

```
node scrape.js                              # whole wiki -> values.json + values.report.json
node scrape.js --only "Headdress|Alpha Set" # just these pages
node scrape.js --limit 25                   # quick test on the first 25 pages
node scrape.js --offline                    # rebuild from the downloaded pages, no internet
node test/run.js                            # tests
```

The first full run takes a while on purpose (one page every 1.5 seconds, to be gentle on the
wiki). Downloaded pages are kept in `.cache/`, so later runs only fetch pages edited since.

`values.report.json` lists pages with no tables, values that are text only, and anything that
failed, so you can see what needs a closer look.

Values and pictures come from the wiki (CC BY-SA). Every item keeps a link to its source page,
and JR should credit the wiki wherever values are shown.
