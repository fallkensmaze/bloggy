# AGENTS.md

This file provides guidance to coding agents working in this repository.

## Commands

```bash
npm run dev       # Start Vite at http://localhost:5173
npm run build     # Build to dist/ and audit public artifacts
npm run preview   # Preview production build locally
npm run audit:public    # Reject sensitive tracked files or public artifacts
npm run test:anon      # DICOM anonymizer regression suite (PHI, conformance, RT references)
npm run test:morse     # Morse trainer assertions (CW timing, Koch decks, quiz invariants)
npm run test:nema      # NEMA NU 1 intrinsic uniformity (edge rule, CFOV, DICOM geometry, states)
npm run test:radio     # Radio-exam XML parsing and quiz building
npm run test:paste     # Secure Paste crypto (the document id must not decrypt anything)
npm run test:pet       # PET DICOM calibration and NEMA NU 2 background ROI placement
npm run test:cor       # SPECT COR centroids, NEMA upper bounds, 3D geometry and ROC
npm run test:fdtd      # FDTD fallback, PEC geometry and JSON configuration
npm run check:security # Anonymizer and paste tests, then build and audit the GitHub Pages artifact
npm run deploy         # Build, audit and deploy dist/ to GitHub Pages
```

No test framework is configured. Use `npm run build` as the minimum integration check. For calculation modules, add or run focused Node assertions against the pure utility functions.

Some modules do have real suites. The Morse trainer has `scripts/test-morse.mjs`
(`npm run test:morse`); run it after touching `src/utils/morse.js` or
`src/utils/morseTrainer.js`. It pins the CW timing numerically, because a
trainer that sends at the wrong speed fails silently: nothing throws, the tone
still sounds, and the student calibrates their ear against a lie. PARIS plus its
trailing word space must take exactly `60 / wpm` seconds, and under Farnsworth
exactly `60 / effWpm`. It also asserts that no question ever offers a character
outside the active deck, so a Koch lesson cannot leak a character the student
has not met yet.

Another is the DICOM anonymizer, which has a regression suite in
`scripts/test-dicom-anonymizer.mjs` (`npm run test:anon`, wired into
`check:security`). Run it after touching `src/utils/dicomAnonymizer.js`. It
builds synthetic DICOM in memory and asserts on the output bytes, and it
enforces the PS3.15 profile **by tag number on purpose**: the anonymizer used to
derive its PHI list from dcmjs keywords and 103 of 221 silently stopped
resolving, so half the profile went unapplied while the tool still reported "no
issues". Keyword-based rules can regress without any visible error, so new PHI
rules belong in the tag-number sets.

The Secure Paste has `scripts/test-paste.mjs` (`npm run test:paste`, also wired into
`check:security`); run it after touching `src/utils/pasteCrypto.js`. Its point is one
assertion that must never go green by accident: decrypting with a key derived from the
**document id** has to fail. That is exactly what the module did for months, and nothing
looked wrong — the page still said "Cifrado AES-GCM" and the text still appeared, because
the browser held both halves. Only a test that decrypts with what the *server* knows, and
demands an error, can tell real encryption from decoration.

The intrinsic uniformity chain has `scripts/test-nema-uniformity.mjs` (`npm run test:nema`); run
it after touching `src/utils/nemaAlgorithms.js`, `src/utils/dicomParser.js` or
`src/utils/nemaAcquisition.js`. Every failure it pins is silent, because a uniformity number is
always produced: nothing throws, the masks render, and the badge turns green or red either way.
The expected values are derived in the file from NU 1-2007 §2.4 and written beside each case, so
they can be checked by hand rather than trusted.

The case worth knowing about is the last one. The UFOV this camera declares (386 × 532 mm) is,
within 0.2 %, the physical extent of its crystal, so summing 0.5994 mm pixels into the 7.79 mm
ones NEMA asks for leaves the outermost row of blocks straddling the edge: ten active raw rows
out of thirteen. Those blocks come out at 76.9 % of the CFOV mean, the 75 % edge rule of the
standard lets them through by less than two points, and they used to drag IU UFOV from 3.1 % to
10.8 % — reporting a conforming detector as failing, on a real flood. NEMA already says to exclude
pixels that held zero counts in the original image; the fix is that the exclusion has to survive
the summation, so `safeBlockReduce()` flags any summed pixel whose block touched a zero. Do not
try to fix it by aligning the block grid instead: 645 active rows admit only 49 complete 13-row
blocks, so a 50th block straddles the edge under every alignment.

The PET NEMA loader has `scripts/test-pet-nema.mjs` (`npm run test:pet`); run it after
touching `src/utils/petNemaDicom.js`. It builds synthetic PET DICOM in memory and pins
what each stored value becomes and which source its transformation came from, because a
wrong Rescale transformation is silent: nothing throws, the phantom and the six spheres
are still found, and the report still prints a plausible contrast — computed on stored
values. The decoder used to read `RescaleSlope` only from the root dataset, so an
Enhanced PET, where it lives in the functional groups, decoded with slope 1 and no one
could tell. The suite also asserts the opposite direction: one file per slice keeps using
its own slope, never a series-wide one.

`npm run test:pet` also runs `scripts/test-pet-rois.mjs`, which covers the placement of the twelve
background ROIs in `src/utils/petNemaAnalysis.js`. NU 2-2018 §7.4.1 puts them as close to the edge
of the phantom as possible but never closer than 15 mm, and repeats them on five planes to reach
60 ROIs. The placement used to pick one ROI per fixed angular sector in isolation, ask for 29.6 mm
between centres and accept whatever it found when that failed: on the synthetic phantom in the
suite that left two ROIs 12.4 mm apart — 24.6 mm of overlap between 37 mm circles reported as
twelve independent measurements, so N_j was not the variability of the image. It also relaxed the
clearance to the spheres through a ladder of [15, 10, 6, 3, 0], which lets a background ROI sit on
hot activity: the background rises, Q_H falls, and the report still prints a plausible number. The
15 mm to the spheres is **not** in the standard and is a reported preference; what is mandatory,
and blocks the calculation, is the 15 mm to the edge and no overlap with a sphere or the lung
insert.

## Architecture

**Falken's Maze** is a React 18 + Vite 8 SPA for Medical Physics and Nuclear Medicine. The GitHub Pages workflow publishes only `dist/`. `vercel.json` remains available for Vercel deployments and rewrites all paths to `index.html` for client-side routing.

### Routing (`src/App.jsx`)

Routes inside `<Layout />` use the shared sidebar and mobile topbar:

- `/` - blog
- `/convert-units` - activity unit conversion
- `/decay-calculator` - radioactive decay
- `/restricciones-lu177` - Lu-177 restrictions
- `/uniformidad-gamma` - intrinsic gamma-camera uniformity
- `/centro-rotacion-spect` - SPECT center-of-rotation NEMA and 3D backprojection analysis
- `/pet-nema-fraccionamiento` - PET NEMA image-quality phantom fill planning and timers
- `/pet-nema-analisis` - PET NEMA NU 2-2018 image-quality analysis of the acquired series
- `/rtplan-compare` - DICOM RT Plan comparison
- `/tg43-calculator` - brachytherapy TG-43 calculator
- `/acr-qc` - ACR MRI quality control
- `/lector` - RSVP speed reader
- `/informe-tanques` - Lu-177 liquid-waste tank report
- `/rt-anonymizer` - in-browser anonymizer for complete radiotherapy DICOM studies
- `/q-codes` - amateur radio Q-code study quiz
- `/morse` - Morse code (CW) trainer
- `/fdtd-simulator` - 3D FDTD antenna simulator powered by Rust/WebAssembly

Standalone routes:

- `/quiz-creator` - quiz editor
- `/quizzes` - public quiz list
- `/quiz/:quizId` - single-player quiz
- `/host/:quizId` and `/join` - real-time multiplayer quiz flow
- `/ptb` and `/ptb/:pasteId` - encrypted Secure Paste flow

### Firebase (`src/firebase.js`)

Firebase config is base64-encoded and split across an array, but this is only
cosmetic because browser Firebase config is public by design. The module exports
`db` (Firestore) and `auth` (Firebase Auth). Do not treat Base64 encoding as a
security boundary. Keep production `firestore.rules` local and ignored, deploy
them from a private environment, and run `npm run check:security` before
publishing. See `SECURITY.md`.

Firestore collections:

- `BLOG` - blog posts, keyed by slug.
- `QUIZZES` - quiz definitions, keyed by slug.
- `QUIZ_SESSIONS` - real-time multiplayer quiz sessions.
- `PASTES` - browser-encrypted Secure Paste payloads.
- `USER_LIMITS` - Secure Paste frequency limiting.
- `EXAM_SESSIONS` - QR exam sessions, with `TICKETS`, `ANSWERS` and `CONFIG`
  subcollections. The session document is readable by any signed-in client, and anonymous
  sign-in is open to the world, so it must never carry `quizId`: with the id, a public
  quiz hands out its own answer key. The id lives in `CONFIG/quiz`, admin-only.
- `RADIO_TEMAS` - private radio-exam topics, admin-only in both directions.

### Main modules

- `src/pages/Blog.jsx` - paginated Firestore feed. Renders Markdown, code highlighting and math.
- `src/pages/UniformidadGamma.jsx` - DICOM flood upload, NEMA NU 1-2007 calculation, Pylinac/IAEA
  cross-check and canvas rendering. It keeps apart three things that used to be a single green
  badge: the NEMA number, the validity of the acquisition, and the comparison against the limits of
  one camera. The resolution selector reports what each option really produces on the loaded file
  (real matrix, effective pixel, counts in the central pixel), and a traceability panel carries
  method version, geometry, pixels removed by cause, detector and window, checks and final state.
- `src/utils/nemaAcquisition.js` - acquisition validation and the four states: `Conforme`,
  `No conforme`, `No evaluable` and `Conforme numericamente, adquisicion no verificada`. A value
  inside the Siemens limits is not conforming if the flood was taken above 20 000 cps, with a
  collimator mounted, closer than 5 × the largest UFOV dimension, or with a pixel that is not
  square. The 0.5 % square-pixel tolerance is attributable to DICOM decimal rounding and is
  documented as a tolerance of this tool, not of NEMA.
- `src/utils/dicomPixels.js` - shared stored-pixel decoding: which transfer syntaxes can be read,
  `BitsStored`/`HighBit` masking with sign extension, the transfer syntax UID, and the frame count.
  Both `dicomParser.js` and `petNemaDicom.js` go through it, so a compressed study is rejected in
  one place and no reader invents frames out of surplus bytes. Note that this build of dcmjs returns
  the file meta group as the dict itself: reading `dicomData.meta.dict` silently yields an empty
  transfer syntax, which then passes as native.
- `src/pages/CorAnalysis.jsx`, `src/utils/corDicom.js` and `src/utils/corAnalysis.js` - in-browser NM multiframe center-of-rotation analysis. The classic branch implements NEMA NU 1-2007 §4.1 and reports all four upper bounds in millimetres. The experimental branch fits the common point of the central source backprojection lines and reports a containing sphere and covariance-oriented ellipsoid. NEMA defines the measurement, not a universal tolerance: keep local limits labelled as provisional until a labelled cohort supports sensitivity/specificity and independent validation.
- `src/pages/PetNemaFractionation.jsx` - PET image-quality phantom fill planner, live countdowns and per-sample initial/residual syringe measurement workflow.
- `src/utils/petNemaFractionation.js` - pure PET NEMA geometry, F-18 decay, theoretical ratios, per-sample recommendations and net activity-at-image projections.
- `src/pages/PetNemaAnalysis.jsx` and `src/utils/petNemaAnalysis.js` - NEMA NU 2-2018 §7.4 image-quality analysis of the acquired series: contrast recovery, background variability and lung residual error. It takes the **measured** `a_H` and `a_B` concentrations and derives the real activity ratio; only their quotient enters the contrast normalisation, so the unit cancels as long as both are expressed alike and referred to the same instant. All six spheres are treated as hot, so it does not implement the NU 2-2007/2012 cold-sphere contrast used by tools such as jQC-PET.
- `src/utils/petNemaDicom.js` - PET series loader. It owns **all** the DICOM in this chain: `petNemaAnalysis.js` receives a `volume[]` whose voxels are already quantitative and contains no DICOM logic at all. Keep it that way. Each frame gets its own Rescale transformation, resolved with the precedence per-frame `PixelValueTransformationSequence` → shared → root dataset → identity, and the resolved calibration is reported back in `series.calibration` so it can be verified. This is not cosmetic: NU 2-2018 §7.4 pools 60 background ROIs across five axial planes, so frames scaled by different factors would inject variability that is not in the image, and while a uniform scale factor cancels in the NEMA ratios, a wrong **intercept** does not. `RealWorldValueMappingSequence` is not read, and no vendor-private factor is applied.
- `src/pages/RTPlanCompare.jsx` and `src/utils/rtPlanParser.js` - DICOM RT Plan comparison.
- `src/pages/Tg43Calculator.jsx` and `src/lib/brachy/` - HDR Ir-192 TG-43 calculations.
- `src/pages/AcrQcPage.jsx` and `src/lib/acr-qc.js` - ACR Medium Phantom DICOM analysis.
- `src/pages/LectorRapido.jsx` and `src/utils/rsvp.js` - RSVP reader with localStorage persistence.
- `src/pages/InformeTanques.jsx` - iframe wrapper for the interactive Lu-177 tank report. The required static report is `public/Informe-Tanques-Terminal.html`; keep it tracked because the page loads it at runtime through `import.meta.env.BASE_URL`.
- `src/pages/QCodes.jsx` and `src/utils/qcodes.js` - Q-code study quiz. Three 4-option question modes (code to meaning, meaning to code, and a cloze over the usage example), a three-step hint ladder (theme, 50/50, mnemonic), Leitner-box spaced repetition that resurfaces weak codes, per-code mastery, theme/deck filters and CW playback through the Web Audio API. Every entry's `example` **must contain its own code**: the cloze mode blanks it out to build the question.
- `src/pages/MorseTrainer.jsx`, `src/components/morse/`, `src/utils/morse.js` and `src/utils/morseTrainer.js` - Morse trainer. The guided course follows LCWO: its exact 41-character order across 40 lessons, timed 1–5 minute random-group copies, Farnsworth timing and promotion at 90% accuracy. The other panels provide free copying practice, a straight key with sidetone, a visual quiz, and the full reference plus a two-way translator. `morse.js` owns the table, encoding, timing and Web Audio, and is shared with `/q-codes`; `morseTrainer.js` owns the LCWO/Koch order, decks, session generation, grading and quiz building. Keep the timing in `morse.js` and the pedagogy in `morseTrainer.js`.
- `src/utils/leitner.js` - Leitner spaced repetition shared by both trainers. `progress` is `{ [key]: { box, correct, wrong, seen } }`, keyed by Q-code in `/q-codes` and by character in `/morse`; `qcodes.js` re-exports it so the page API did not change.
- `src/utils/localSettings.js` - tolerant localStorage reads for page preferences.
- `fdtd-wasm/src/lib.rs`, `fdtd-wasm/src/cartesian3d.rs`, `src/pages/FdtdSimulator.jsx`, `src/components/fdtd/FdtdField3D.jsx` and `src/utils/fdtd*.js` - the 3D antenna solvers. Rust/WebAssembly is the production backend; numerically equivalent JavaScript implementations are the compatibility fallback and supply Node regression tests. Dipoles, vertical monopoles and centre-fed long wires evolve `Er`, `Ez` and `Hphi` on a meridional `(r,z)` grid, use the cylindrical-axis update at `r=0`, CPML at the outer radial and axial boundaries, and reconstruct the full volume by revolution. The Yagi-Uda uses a Cartesian `(x,y,z)` solver with all six field components so its reflector, driven element and directors remain parallel wires instead of rotational rings. Both solvers export signed magnetic/electric components and `|E|`. The pulsed feed monitor provides broadband `Zin(f)` in ohms and `S11` relative to 50 ohms; a continuous source only validates the nominal-frequency bin, because ratios at the other bins are spectral leakage rather than impedance. `fdtdAnalysis.js` masks bins without sufficient current and accepts resonance only from an interpolated `Xin = 0` crossing. Surface current is derived from the circulation of the magnetic field, and its complex distribution supplies the far-field E-plane pattern and 3D directivity. Keep both Rust and JavaScript public APIs numerically equivalent and run `npm run test:fdtd` after either changes.
- `src/pages/RtAnonymizer.jsx`, `src/utils/dicomAnonymizer.js`, `src/utils/zipDownload.js` - client-side DICOM RT study anonymizer. It remaps all non-standard UIDs consistently across CT/RTSTRUCT/RTPLAN/RTDOSE, preserves RT references and PixelData, writes de-identification markers, and downloads a STORE-only ZIP.
- `src/pages/QuizHost.jsx`, `QuizJoin.jsx`, `QuizPlay.jsx`, `QuizList.jsx`, `QuizCreator.jsx` - quiz system.
- `src/pages/PasteCreate.jsx`, `PasteView.jsx` and `src/utils/pasteCrypto.js` - AES-GCM
  Secure Paste. The 256-bit key is random, independent of the document id, and travels
  only in the URL fragment (`/ptb/CODE#k=...`), which browsers never send to the server.
  It used to be derived from the document id, so anyone who could read the document could
  derive its key: the ciphertext was decorative. Never derive the key from anything that
  reaches Firestore. `decryptLegacyPasteContent` exists only to keep already-shared links
  working and can be deleted once every pre-change paste has expired (7 days maximum).

### PET NEMA fractionation

The PET NEMA implementation is documented in `PET_NEMA_FRACTIONATION.md`. It was migrated from the historical workbook `PET.Prueba de calidad de imagen.Fraccionamiento.xlsx`, which is no longer tracked in the repository.

Keep domain calculations in `src/utils/petNemaFractionation.js` and UI concerns in `src/pages/PetNemaFractionation.jsx`. Preserve the operational assumptions unless the protocol is intentionally revised:

- F-18 half-life and acquisition interval: 110 minutes.
- Background concentration at both acquisitions: 5.3 kBq/ml.
- Sphere-to-background ratios: 8:1 for the first acquisition and 4:1 for the second.
- Prepare two background fractions and add the second after the first acquisition. Their required activity is identical only when both are prepared at the same time.

### Key dependencies

- `dicom-parser` and `dcmjs` - DICOM parsing.
- `marked`, `highlight.js`, `dompurify`, `katex`, `marked-katex-extension` - technical content rendering.
- `chart.js` and `react-chartjs-2` - charts.
- `firebase` - Firestore and Auth.

### Styles

Global styles live in `src/styles.css`. Feature-specific stylesheets live in `src/styles/`:

- `acr-qc.css`
- `lector.css`
- `morse.css`
- `pet-nema.css`
- `quiz.css`
- `rtplan.css`
- `tg43.css`
- `uniformidad.css`

The UI uses CSS custom properties from `src/styles.css`, such as `--bg-secondary`, `--text-muted`, `--accent-blue` and `--border`.
