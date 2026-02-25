# Resume ATS Analyzer (MVP)

Small web app to:

- Paste a job description
- Paste/upload a resume (`.txt`, `.docx`, `.pdf`)
- Get a simulated ATS-style match score (`0-100`)
- See missing keywords, breakdown, and formatting suggestions
- Generate an optimized resume draft (uses OpenAI if `OPENAI_API_KEY` is configured)

## Run locally

```bash
npm install
cp .env.example .env   # optional, for AI optimization
node server.js
```

Open `http://localhost:3000`.

## Notes

- The score is a **simulated match score**, not a real vendor ATS score.
- Real ATS behavior varies by platform and recruiter workflows.
- AI optimization is optional and should be reviewed for accuracy before use.
