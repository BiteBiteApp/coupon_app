# Android Release Signing

Use a local upload keystore for Google Play builds. Do not commit the keystore
or `key.properties`.

Generate the upload keystore:

```bash
keytool -genkey -v -keystore android/upload-keystore.jks -storetype JKS -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

Create the local signing properties:

```bash
cp android/key.properties.example android/key.properties
```

Edit `android/key.properties` with the passwords used for the keystore.
`storeFile` is resolved relative to the `android/` directory, so the default
`storeFile=upload-keystore.jks` points to `android/upload-keystore.jks`.

Build the Google Play app bundle:

```bash
flutter build appbundle --release
```

The bundle is written to `build/app/outputs/bundle/release/app-release.aab`.
