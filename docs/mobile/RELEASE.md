# Mobile store release runbook

Status of each gate lives in issue #68. Nothing here is marked complete by this document.

## iOS (Apple account and identifiers already in place)

1. In GitHub, create the `mobile-release` environment with required reviewers. Add secrets:
   `APPLE_TEAM_ID`, `IOS_DISTRIBUTION_CERT_P12_BASE64`, `IOS_DISTRIBUTION_CERT_PASSWORD`,
   `IOS_PROVISIONING_PROFILE_BASE64`, `IOS_PROVISIONING_PROFILE_NAME` (App Store profile for
   `com.bullebrowser.mobile`), and for upload `APP_STORE_CONNECT_KEY_ID`,
   `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY_P8`.
2. Run **mobile-ios-release** (Actions, manual). First run with `upload` off to confirm the signed archive/IPA builds; then rerun with `upload` on to send to TestFlight. The workflow has not yet been run; expect to fix signing details on the first attempt.
3. In App Store Connect: complete the listing, icons, screenshots, App Privacy answers (review against `PrivacyInfo.xcprivacy` and the provider data flow) and export-compliance answers.
4. Physical iPhone/iPad QA via TestFlight using the acceptance list in `README.md`, including VoiceOver.
5. Submit for review. After the TestFlight or App Store URL exists, set repository variable `IOS_APP_URL` and redeploy the website.

## Android (Google Play Console)

1. Create a Play Console developer account (identity verification can take days). New personal accounts must run a closed test with 12+ testers for 14 days before production access.
2. Create the app with application ID `com.bullebrowser.mobile`; enroll in Play App Signing.
3. Generate an upload keystore (`keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000`), back it up outside git, and register its certificate with Play.
4. Build a signed release AAB (`./gradlew bundleRelease` with signing config from CI secrets). Not yet automated in this repo; the existing workflow builds only a debug APK.
5. Complete the store listing, Data safety form, content rating, target audience and app access (reviewer test login) declarations.
6. Upload the AAB to an internal or closed testing track, run physical-device and TalkBack QA, then promote.
7. Set repository variable `ANDROID_APP_URL` to the Play or testing URL and redeploy the website.
