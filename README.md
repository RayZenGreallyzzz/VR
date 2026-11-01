## v1.5 — Stability milestone 1 (wing quality, export validation, fit preflight)

**User-visible changes:**
- Wing folding now checks sampled triangle edge/area distortion. On a severe crumple or degenerate fold the edit is rejected and pristine geometry / last validated pose restored rather than saving a broken wing. Imported normal-map TANGENT data are recalculated/removed when geometry changes. UVs stay untouched.
- Every GLB save checks that each expected attachment contains actual mesh descendants, skinned skeleton joints and animation node references are valid, PNG images physically contain PNG headers inside the binary chunk (not merely a `mimeType` claim), and WebP external dependencies are absent.
- SmartFit now has **🔍 Проверить зоны тела**: quick shoulder/chest/waist/hip/upper-leg/calf estimates, warnings for wrong body mesh / excessive wing span, before fitting. No skeleton is required.
- New automated GLB export -> reimport and geometry tests; unit tests for PNG binary verification and wing rollback.

**What is NOT finished yet:** full closed semantic Body Cage 2.0, arbitrary one-click accurate garment draping/weighting on *all* meshes, true texture atlas and high-poly→low-poly normal baking, guaranteed wing folding for every fragmented feather topology, Khronos validator integration. These remain in issue #17. Strict validator is structural, not a full conformance or visual fidelity guarantee.

**Testing plan:** on actual Android tablet, first use a pair of wings at 0/25/30 degrees with native textures, save/reopen to verify. Then test dress fit on woman GLB. Finally import long-tail GLB with repeated textures, verify both skin and animation and appearance in a second viewer. Keep the unmodified source GLBs as backups. Debug APK has distinct Android ID so v1.4 can coexist.

## v1.4 — Universal portable PNG materials & safer wing folding

- **Every GLB export** (also editable project) temporarily renders every avatar and accessory PBR texture into PNG. No EXT_texture_webp dependency is left in the saved GLB; the exported binary JSON is verified and the original editor textures are restored even when saving fails. This applies to **tails, wings, clothing, hair, horns, ears and all imported details** equally. Select 1024/2048/4096 texture size in the UI; 2048 is the Android default.
- **16× and other identical UV tiling transforms** are moved into mesh UV0 coordinates when all texture maps of a single-material mesh agree. Standard glTF REPEAT sampling is preserved without KHR_texture_transform; materials with multiple conflicting UV transforms retain the standard extension rather than corrupting textures.
- **Wing folding** decodes quantized/interleaved vertex attributes into float32 before deformation, keeps UV/materials unchanged, uses a continuous swept-arc bend without the old hinge-position discontinuity, and handles small independent feather meshes rigidly to reduce paper-crumple.
- **No false atlas claim:** PNG packing in one GLB does **not** unify all materials into one UV atlas, nor physically weld separate mesh objects to the avatar. Skin and individual PBR slots are preserved. Universal atlas merging and true multi-piece feather topology analysis are separate work.
- **Resource safety:** texture conversion is sequential in Android and uses max 2048 resolution by default. In a 4 GB tablet, large source GLBs (>1 M triangles and many 4K textures) may remain slow or exceed memory; do not assume real-device validation until tested there.

## v1.3 — SmartFit placement repair (experimental)

v1.2 made several user-visible mistakes: it mounted clothes to a chest anchor before fitting, measured torso width using T-pose arms, treated the head-trimmed Body Cage as the full character height, and pulled garment vertices toward the nearest body triangle (flattening volume). It could misleadingly report a successful fit when the actual cloth shape was wrong.

**v1.3 fixes:**
- Clothing GLB imports in model-root space; v1.2 chest-mounted garments are detached safely on automatic fit without changing their world location.
- Uses *full avatar body* height and samples central torso/hips with arm rejection. Outfit top placement depends on type: top/dress, skirt, pants.
- Scales by garment torso or waistband (ignoring wide sleeves and skirts) then centers the whole garment.
- Optional BVH pass **pushes only outward**, with small displacement limit; sleeves, trouser legs, and wide skirts are not sucked into the surface.
- Reports numeric fit scale and vertex count. Preserves original avatar mesh, clothing UVs/materials and editor-only preview cage.
- Automated T-pose/A-pose placement, root-space clothes, collision relief, and unrigged stage tests.

**Limits:** Prototype geometric fitter, not physical clothing simulation, not complete auto bone rigging, does not detect garment semantic zones perfectly on arbitrary topology, and does not automatically remove existing fused underwear. A-pose vs T-pose sleeve mismatch may require pose retargeting. Test with a real target GLB on Android to evaluate placement.

## v1.2 — Phoenix SmartFit Body Cage (first working prototype)

**One-button flow:** Load an avatar GLB, import garment as **👕 Одежда**, choose the source body surface, select *dress/top/pants/skirt*, tap **✨ Надеть выбранную одежду автоматически**. A lightweight Body Cage is generated if needed; it guides a shape/position fitting pass. On an already-rigged body, the app then attempts clothing weight transfer. On unrigged bodies, the operation fits the cloth but **explicitly reports** that rigging is still necessary for animation.

**Body Cage:** Up to 48,000 sampled source triangles, processed in batches for mobile. Adapted to Meshy/Tripo's huge GLBs with hundreds of disconnected mesh islands — does not naively pick the biggest connected island. Optional upper-height cutoff (78%, 86%, 94%, or full model) helps exclude horns/hair; choose an appropriate body source for the costume. Green wireframe preview can be hidden. The sampled cage lives outside the saved avatar scene, so it **never replaces the original detailed mesh** and is **not exported**.

**Current limitations:** This is a reduced triangle-surface proxy with BVH proximity fitting — **not a real volumetric SDF**, not universal semantic garment segmentation, not automatic underwear removal, not collision-free physical fabric, and **not automatic full-body rigging**. Shorts/top fused into a single texture/body mesh remain part of the source. A high-density rigged body may exceed the existing skin-transfer maximum (240k triangles); shape fit still completes with a clear warning. Long hair/antlers and strongly nonstandard body shapes may require manual cage cutoff and adjustment. The v1.2 Android build passes synthetic geometry tests; real-device fitting of the user's >0.7M-triangle male and >1.3M-triangle deer-woman GLBs still needs validation on the Android tablet.

## v1.1 — Put clothes on effortlessly + pull skirt hem outward

1. Load the avatar (a skinned or ordinary GLB mesh) and import your GLB clothing using the **👕 Одежда** type.
2. In **2В · Одежда без заморочек**, choose the character body mesh and style (dress / skirt / top); tap **✨ Авто-подгонка по телу**. The editor adjusts proportional garment size and location, and gently draws nearby garment vertices toward the body surface with controlled clearance. For dresses/skirts, lower-body volume is protected.
3. For a puffier skirt, show the **yellow hem drag handle**, or drag the clothing edge near its bottom in the 3D viewport. Push out to expand, pull in to narrow. Precise `−/+` and multiplier inputs range 0.7–3.0. The upper garment/waist does not expand, and source UV coordinates remain unchanged.
4. Save editable GLB, or, **after** fitting and flaring, optionally perform clothing weight transfer on a rigged character, test shoulder/knee poses, and export.

The hem tool recomputes from an immutable geometry snapshot; repeated edits do not accumulate errors. Geometry is baked in the exported GLB. As with other prototype sculpting tools, undo/redo applies to hem width changes within the current session; the initial auto-fit operation is not yet undoable as a single geometry transaction. Re-importing the exported GLB uses the baked shape as the new baseline. Do the surface fit before adding skin weights.

**Limitations:** auto-fit is controlled nearest-surface wrapping, not full cloth simulation or guaranteed one-click fitting for every costume. Highly unusual silhouettes, long loose sleeves, multi-layer armor, and asymmetrical meshes can need manual adjustment. Skirt flare assumes Y-up garment geometry with an identifiable hem. Android 15 real-device verification remains necessary.

## v1.0 — Clothing skin-weight transfer (beta)

- **Import GLB as "👕 Одежда"** and fit it to a **rigged** base avatar in rest A/T pose using XYZ, rotation and scale.
- In **2В · Weight Transfer** choose the source body **SkinnedMesh**. Nearest body triangles are found using an accelerated BVH; the source weights are interpolated with barycentric coordinates and reduced to four normalized bone influences per clothing vertex.
- The garment becomes a real **SkinnedMesh referencing the original body skeleton**. The editor reparents it out of the chest/head bone to avoid double motion. Body weights and the clothing's geometry, UVs and materials remain intact.
- The closest-surface distance guard is adjustable to 10%, 18%, or 30% of body height. If any garment vertex has no matching body surface within the allowed distance, the operation refuses to modify the clothing; use the correct body source/fit, or increase tolerance cautiously.
- **Check shoulders/knees** test pose temporarily rotates recognized shoulder/elbow/leg bones. **Restore original pose** puts those bones back before export; generated weights and shared skeleton survive GLB export/reimport.
- The mobile preview caps body source at 240,000 triangles, clothing at 120,000 vertices and 24 clothing meshes in one import to avoid worst-case memory spikes on 4 GB Android.
- **Limitations**: Complex layered costumes, long skirts, bags, very loose clothing, and fingers/gloves may need manual skin-weight cleanup; this first implementation does not solve cloth physics, add missing skeletons, eliminate body penetration, or guarantee VRChat readiness. Preserve A/T pose before transfer. Voxel/biharmonic transfer and manual weight painting are later work.

## v0.9 — Combined tablet QA: tails, editable GLB, Undo/Redo

- **3 articulated tail joints + automatic normalized skin weights** for separately imported GLB tails; select the tail's major axis and which end attaches to the body. Play/stop a basic wag clip and include the clip in GLB export. Optional; original humanoid rig untouched.
- **Save Editable Project GLB** embeds all accessory meshes (including temporarily hidden parts), transforms and part configuration metadata in one GLB file. **Open Editable Project** restores these layers for additional adjustment without separately locating imported GLBs. Regular avatar GLB export keeps only visible accessories.
- **Undo / Redo** covers accessory position, rotation, scale, visibility and unrigged wing bend settings, up to 80 snapshots. Add/remove, rig creation, and geometric sculpting are not yet undoable.
- Existing two-bone wing rig, fold presets, high-poly chunked wing operations and Android SAF save picker stay available.
- **Limitations:** a wing with already-exported skin cannot be non-destructively unbent and re-rigged; opening retains its skinned mesh and animation clips. Tail and wing rigs are prototypes, not VRChat-ready PhysBones. Clothes auto-skin and facial morph editing are still pending.
- For tablets with 4 GB RAM, initial automatic tail rigging is capped at 250,000 vertices. This is a safe-start cap, not a permanent format limit.
- Validate Android 15 file picker, touch controls, heavy GLB models and actual device stability on the tablet; CI alone does not prove those.

## v0.8 — optional wing skeleton and flap animation (experimental)

- **Create two wing bones + automatic skin weights** after fitting and folding wings. This adds a separate WingRoot + WingLeft/WingRight skeleton to imported wing geometry without altering the avatar's original skeleton.
- **Flap preview / Stop** use the Three.js animation mixer. The generated glTF animation clip accompanies other imported animations when saving the GLB.
- A feathered hinge strip shares weights with the center bone to reduce tearing near the wing mount. The mesh keeps its original materials, texture coordinates and vertex count.
- For Android memory safety, wing rig creation is limited to **250,000 vertices** per wing part. Higher-poly wings remain foldable in v0.7's chunked mode.
- This is a **basic two-bone wing rig**, not full multi-joint flight physics or VRChat PhysBones. Unity/VRChat SDK setup and platform validation are still separate. Imported wings that already have a skeleton are not overwritten.

**Testing:** CI checks valid skin weights, separate wing joints, flap keyframes, GLB export and re-import. Android touch behavior and custom textured GLB cases still require manual device testing.

# Phoenix VR Avatar Studio (Android / Web)

Separate avatar-customization app derived from the workflow of Rig Animation Studio **v7.9**. Does not modify the original animation editor.

## v0.7 — bend heavier wings on Android

- The 100,000 vertex **live edit** threshold remains for responsive small GLBs. From 100,001 to 600,000 wing vertices, folding uses asynchronous, cancellable 6,000-vertex batches and an in-panel progress indicator instead of blocking the screen.
- Repeated slider movement coalesces updates; an obsolete partial bend is replaced by a full rebake from pristine vertex positions.
- **GLB export waits until all active wing operations finish.** This prevents saving only the first part of a large wing mesh.
- Export validation reads only the **GLB JSON header and node metadata**, not a second copy of all meshes/textures. This reduces memory use when saving dense characters on Android.
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
