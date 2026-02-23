abq-media doctor
→ Check: Node version, internet, API key validity, ffmpeg (if audio)
→ Output: green/yellow/red per check, fix suggestions inline

abq-media init [--project <name>]
→ If project exists: "Update it or start fresh?"
→ Collects: - Project name (slug, used for folder naming) - Your publishing handle (@you on X, YouTube channel name) - Your CTA (one sentence: "Subscribe at...") - Tone preset: [informative / conversational / urgent / academic] - Default language - API key (stored in ~/.abq-media/credentials, never in project folder) - Default output formats (can override per run)
→ Writes: ~/.abq-media/projects/<name>/config.json

abq-media run [--project <name>] [--input <type>] [--output <type>]

PHASE 1 — INPUT SELECTION
→ "What are you working with today?"
[ Audio file | YouTube link | Document | I'll type it ]
→ Input is ingested, normalized to clean text transcript

PHASE 2 — OUTPUT SELECTION  
 → "What do you want to produce?"
[ Full package | Article only | Social only | Audio summary ]
→ Full package = all formats; single = one format

PHASE 3 — PIPELINE (auditable)
→ Stage 1: Transcribe / clean input [✓ view] [✓ edit] [✓ continue]
→ Stage 2: Extract key ideas or generate prompt [✓ view] [✓ edit] [✓ continue]
→ Stage 3: Generate per format [✓ view] [✓ edit] [✓ continue]
→ Stage 4: Inject brand (handle + CTA) [✓ view] [✓ edit] [✓ continue]

PHASE 4 — REFINE
→ Per output: "Approve / Retry with note / Edit manually"
→ Max 2 AI retry cycles; after that, open in $EDITOR
→ Template overlays available: [punchy | formal | thread | longform]

PHASE 5 — EXPORT
→ Assembles zip: ~/abq-media/exports/<project>-<date>-<slug>.zip
→ Shows manifest of what's inside
→ Offers: "Copy tweet thread to clipboard? [y/N]"
→ Done screen: path + next suggested command
