import fs from "fs";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const text =
  fs.readFileSync(`${root}/js/data.js`, "utf8") +
  fs.readFileSync(`${root}/index.html`, "utf8");
const urls = [
  ...new Set(text.match(/https:\/\/images\.unsplash\.com\/[^"']+/g) ?? []),
];

const head = (url) =>
  new Promise((resolve) => {
    const req = https.request(url, { method: "HEAD" }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", () => resolve(0));
    req.setTimeout(15000, () => {
      req.destroy();
      resolve(0);
    });
    req.end();
  });

const bad = [];
for (const u of urls) {
  const st = await head(u);
  if (st !== 200) bad.push({ status: st, url: u });
}
console.log(JSON.stringify({ total: urls.length, bad }, null, 2));
