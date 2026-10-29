# Phoenix VR Avatar Studio v0.1 — Android 15 smoke test

This branch exists to test the **Android APK pipeline** without changing the existing Rig Animation Studio v7.9.

## Automated checks
- All avatar core Node tests pass.
- Vite production build compiles.
- Capacitor Android project is generated.
- Gradle `assembleDebug` completes.
- The APK ZIP structure passes `unzip -t`.

## Manual device checks needed before release
- Install on Android 15; launch app without crashing.
- Open procedural mannequin demo (no skeleton) and orbit/pinch zoom.
- Import a rigged GLB and verify actual bones/head/hips counts.
- Attach hair and ears GLBs to head; rotate and reposition.
- If the model has morph targets, test facial sliders.
- Export GLB and JSON and validate both files in an independent viewer.

Note: functional VRChat upload still requires Unity Editor and VRChat SDK on Windows.
