1.  yt‑dlp dependency

- End users will still need yt‑dlp installed to run --url with ASR.
- We should document install options clearly:
  - Homebrew (if possible)
  - Standalone binary (recommended for older macOS)
- Consider adding a helper command: abq-media doctor --deps or abq-media setup --install-yt-dlp.

2. ASR chunking behavior

- Implemented chunking for input_too_large errors.
- Uses ffmpeg to split into 10‑minute segments (segment_time 600).
- Each chunk is transcribed and concatenated.
- Document this limit so users know why long videos still work.

3. Optional starter credits

- Explore bundling limited credits (OpenAI/OpenRouter/ElevenLabs) so first‑time users can run a demo without setup.
- Requires a policy decision (budget + rate limits).

———
