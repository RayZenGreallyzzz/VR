# Phoenix VR Avatar Studio (Android / Web)

Separate avatar-customization app derived from the workflow of Rig Animation Studio **v7.9**. Does not modify the original animation editor.

## v0.7 — bend heavier wings on Android

- The 100,000 vertex **live edit** threshold remains for responsive small GLBs. From 100,001 to 600,000 wing vertices, folding uses asynchronous, cancellable 6,000-vertex batches and an in-panel progress indicator instead of blocking the screen.
- Repeated slider movement coalesces updates; an obsolete partial bend is replaced by a full rebake from pristine vertex positions.
- **GLB export waits until all active wing operations finish.** This prevents saving only the first part of a large wing mesh.
- Safety: geometry beyond 600,000 wing vertices still cannot be live-bent on a 4 GB tablet without preprocessing; import and rigid positioning remain available.
- The 25° and 30° mirrored fold presets, always-visible wing panel, and back attachment locator from prior versions remain.

**Verification:** automated unit tests include a 120,003-vertex fold and cancellation/restore scenario. Android-specific stability still requires a real-device test, especially for texture-heavy GLBs.

## v0.6 — Wings editor stays visible

- A permanent sidebar section **2A · Wing fold** shows even before a part is selected. No more disappearing "Fold back 25° / 30°" controls.
- Its **Wing target** selector lists every imported accessory. An existing imported part can be converted to wings using **Assign selected detail as wings**, without re-import.
- Converted wings are automatically re-anchored from head/other bones to the **back**.
- If a GLB contains no vertices or is above the safe live deformation limit (100,000 wing vertices on mobile), the sidebar shows an explicit diagnostic instead of hiding the controls.
- Preset buttons are disabled when unavailable, and enabled for a properly loaded wing mesh. Protects the Android tablet from accidental massive geometry operations.

**Install:** v0.6 has a separate Android package ID. This corrects editor visibility, not VRChat SDK support or high-poly deformation performance.

## v0.5 — fold both wings around central attachment

The Wing panel now includes one-tap **Fold backward 25°** and **Fold backward 30°**. This rotates each wing half in opposite directions around the shared center, yielding a V when viewed from above. The central anchor strip stays still so the wings can be positioned on the character's back.

If the source GLB is oriented unusually, switch **Wing span axis** between Auto/X/Y/Z and reverse fold direction. The center can be moved left or right to match asymmetrical wing assets. The last bend direction, axis, center offset and 25°/30° angle are persisted in project JSON.

The fold modifies the wing **mesh vertices** and is present in exported GLB. It does not create animated wing bones or skin weights. As before, dense wing meshes may be too heavy for interactive mesh deformation on a 4 GB tablet; v0.4 safety guards remain enabled.

## v0.4 — Android touch crash prevention

- Scale control is now **explicit**: `− / +` or type a number and press `Применить`. Scrolling the menu cannot drag a scale slider.
- Imported accessory size is clamped to the size of the loaded avatar (wings at most ~3 avatar heights in span; tail ~2 heights). A clear warning appears when capped.
- Wing bend/stretch sliders start locked and re-lock on scrolling or after inactivity. They can be unlocked deliberately.
- Live wing deformation is coalesced into one animation frame; very dense wings (>100,000 vertices) remain attachable but skip live deformation to reduce memory pressure on 4 GB Android devices.
- Mobile WebGL pixel ratio limited to 1 and rendering limited to approximately 30 FPS.
- If the model has no suitable skeleton bone, accessories use stable **back/hips/head fallback locators** based on the avatar's *original* body bounds instead of inheriting an arbitrary root offset.

**QA:** The new size limit is a protection for mobile interactive editing, not a permanent polygon limit on imported avatar models. It does not auto-skin parts or generate missing bones. Actual crash cause still requires Android logcat evidence; this patch targets the reproducible unsafe scenario.

## v0.3 — Android Save As + wing mesh baking

- **Export GLB / JSON** opens Android's system **Create Document** picker so you can select the destination folder and filename. Files are streamed to the selected URI in 96 KiB chunks.
- **Wings** now have non-destructive geometry modifiers for a bend at the center hinge, lengthening the outer span, and moving the hinge.
- The actual `BufferGeometry` vertices are edited while preserving materials, UV attributes, mesh hierarchy, and skin attributes; the modified wing geometry is exported.
- Before saving, the exported binary GLB is parsed back and attachments are counted; if an attachment is missing, save is stopped.
- Added automated GLB round-trip regression coverage.

**Important:** adding details to one GLB file **does not** automatically fuse them to the body skin mesh or paint deformation weights. Rigid accessories remain separate meshes attached to the chosen bone. An actual skinned, seamless body/garment merge requires a later skin-transfer workflow.

v0.3 uses a new Android package ID for side-by-side testing with v0.1 and v0.2. APK installation and SAF file picker still need manual Android 15 verification.

## v0.2 — 3D transforms (Android touch)

1. Import the main avatar GLB, then import any accessory GLB.
2. Select the accessory in the list and use **Двигать** to drag the 3D arrows in X/Y/Z.
3. Choose **Кольца XYZ** for axis rotation, or **Шар** for free-form rotation by dragging the central sphere.
4. Switch **Оси: локальные / мировые** to change gizmo axes. Numeric coordinates remain local to the attached bone.
5. For precise adjustments enter any finite XYZ value in metres and XYZ rotation in degrees, or tap the -/+ buttons.
6. Use **Сброс X/Y/Z**, **Сброс поворота**, or **Сброс всего** to undo placement.
7. Export GLB. The transform helper is an editor overlay, not part of the exported geometry.

**Limitations:** rotation pivot is the accessory origin on the attachment bone. The free-rotation sphere and axis rings need manual touch testing on Android 15. This is a rigid accessory transform tool; skin transfer / clothing rigging is separate. The original Rig Animation Studio is unchanged.

## First prototype
- Import GLB avatar, attach GLB hair, ears, horns, tail, wings, hats and accessories.
- Bone anchor presets: head / neck / chest / back / hips. Position, rotation and scale controls.
- Facial Blend Shape sliders (only if the imported GLB includes those morph targets).
- Basic skeleton, skinned mesh and triangle diagnostics (no hard polygon limit).
- Export an assembled GLB and a JSON configuration.

**Limitations:** rigid accessories are not skin-weighted clothing, new replacement heads do not have automatic seam blending, VRM/FBX import isn't present in v0.1, and VRChat publishing still requires Windows Unity Editor with VRChat SDK, Avatar Descriptor, humanoid mapping and platform-specific validation. This is not a finished production APK.

## Run
Requires Node.js and npm:
```sh
npm install
npm test
npm run dev
npm run build
npx cap add android
npm run android:apk
```
The GitHub Actions workflow can compile a **debug** Android APK after the source and dependencies are present in this repository.

## v7.9 source recovery
The supplied v7.9 APK contains 178 identifiable first-party TypeScript source files in the Vite source maps and bundled web assets. This is a **partial recovery**, not the complete original project source. The separate downloadable archive includes the recovered sources, bundled legacy editor and app prototype. APK native Gradle sources and signing keys were not recovered.

## Licenses
The legacy editor is based in part on Mesh2Motion (MIT code, upstream CC0 assets per its README). Three.js is MIT. Preserve source copyright/license notices and check rights before publishing third-party models or animations. Phoenix VR is not affiliated with VRChat or Unity.
