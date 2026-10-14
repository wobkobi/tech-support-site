# Brand and marketing files

Where every public-facing file lives. Anything generated can be rebuilt from its script, so only the
hand-made artwork is versioned.

| What                                                     | Where                                | In git | Rebuild with                               |
| -------------------------------------------------------- | ------------------------------------ | ------ | ------------------------------------------ |
| Logos, backdrop, portrait (source artwork)               | `public/source/`                     | yes    | -                                          |
| Embroidery artwork + spec                                | `brand/embroidery/`                  | yes    | -                                          |
| Facebook image ad guidance                               | `brand/facebook-ads-design-guide.md` | yes    | -                                          |
| Card, A5 poster, sign PDFs (linked from site)            | `public/downloads/`                  | yes    | `build:card`, `build:poster`, `build:sign` |
| Paid Meta ad creatives                                   | `marketing/ads/`                     | no     | `npm run build:ads`                        |
| Organic posts (4:5 for Meta, 4:3 for Google)             | `marketing/posts/`                   | no     | `npm run build:social`                     |
| Cover/banner images (Facebook, LinkedIn, YouTube, X)     | `marketing/banners/`                 | no     | `npm run build:icons`                      |
| Profile pictures, Google/Apple Business logos            | `marketing/profiles/`                | no     | `npm run build:icons`                      |
| Favicons, og image, email signature, QR code             | `public/`, `public/assets/`          | yes    | `npm run build:icons`                      |
| Superseded drafts (2025 posters, first-round embroidery) | `brand/archive/`                     | no     | -                                          |

`public/` is served on tothepoint.co.nz, so only files the site links to belong there. Images that
are only uploaded to a platform by hand go in `marketing/`.

Print proofs from Perfection Print are not kept here.
