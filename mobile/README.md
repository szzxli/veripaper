# veripaper mobile build

WebView wrapper APK for the veripaper web app.

**Important:** veripaper is a network-first tool — every lookup hits CrossRef /
DataCite / arXiv / Semantic Scholar / OpenRouter live. The manifest therefore
declares `INTERNET` (unlike offline-first wrappers). Without it the app loads
but every check fails.

## Build (manual — Gradle daemon fails in this sandbox)

```bash
cd mobile/apkbuild
export PATH=~/workspace/tools/jdk-21.0.12.1+1/bin:$PATH
BT=~/workspace/tools/android-sdk/build-tools/34.0.0
AJAR=~/workspace/tools/android-sdk/platforms/android-34/android.jar

# 1. refresh web assets
cp ../../web/index.html ../../web/ground.js ../../web/manifest.json ../../web/sw.js assets/www/

# 2. link
$BT/aapt2 compile --dir . -o build/compiled.zip
$BT/aapt2 link -o build/base.apk -I $AJAR --manifest AndroidManifest.xml \
  -A assets --min-sdk-version 24 --target-sdk-version 34 build/compiled.zip

# 3. compile + dex
mkdir -p build/classes build/dex
javac -source 8 -target 8 -bootclasspath $AJAR -d build/classes \
  src/com/szzxli/veripaper/MainActivity.java
$BT/d8 --lib $AJAR --output build/dex \
  build/classes/com/szzxli/veripaper/MainActivity.class

# 4. pack, align, sign
cp build/base.apk build/unsigned.apk
(cd build && zip -j unsigned.apk dex/classes.dex)
$BT/zipalign -f 4 build/unsigned.apk build/aligned.apk
$BT/apksigner sign --ks debug.keystore --ks-pass pass:android \
  --key-pass pass:android --out veripaper.apk build/aligned.apk
$BT/apksigner verify --print-certs veripaper.apk
```

## Notes

- Debug-signed. Package: `com.szzxli.veripaper`. Label: `veripaper`.
- Rebuild after any `web/` change: re-copy assets and rerun from step 2.
- The APK binary itself is not committed to git; it is distributed via
  time-limited download links.
