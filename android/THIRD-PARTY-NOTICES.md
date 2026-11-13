# Android source notices

- The local asset-hosting pattern is adapted from the user's Navrang Gate project. Its MIT notice is included in [LICENSES/Navrang-MIT.txt](LICENSES/Navrang-MIT.txt). No Navrang artwork, private configuration, backend records or signing identity is included.
- The Gradle wrapper is distributed under Apache License 2.0. See [LICENSES/Gradle-LICENSE.txt](LICENSES/Gradle-LICENSE.txt).
- The vendored offline QR encoder retains its [license](web/vendor/QR-LICENSE.txt) and [source notices](web/vendor/QR-SOURCES.md).
- The older prototype's Bullseye artwork remains with that prototype. The new source trees use neutral fixture images. Approved private artwork is supplied separately for authorized builds.

## ZXing Android Embedded

Camera QR scanning uses `com.journeyapps:zxing-android-embedded:4.3.0` and its ZXing decoder dependency, under Apache License 2.0. Source and license: https://github.com/journeyapps/zxing-android-embedded and https://github.com/zxing/zxing. Camera frames are decoded on device and are not uploaded or stored by SharePass.
