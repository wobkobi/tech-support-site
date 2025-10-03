// scripts/build-icons.mjs
import sharp from "sharp";

const SRC = "public/logo.svg"; // or "public/logo-full.svg"
const BG = "#f6f7f8";
const outs = [
  ["public/apple-touch-icon.png", 180],
  ["public/android-chrome-192x192.png", 192],
  ["public/android-chrome-512x512.png", 512],
  ["public/favicon-32x32.png", 32],
  ["public/favicon-16x16.png", 16],
];

for (const [file, size] of outs) {
  await sharp(SRC)
    .resize(size, size, { fit: "contain", background: BG })
    .flatten({ background: BG }) // fills any transparency with BG
    .png()
    .toFile(file);
}
