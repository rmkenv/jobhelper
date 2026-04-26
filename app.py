import streamlit as st
import requests
import json
import time
import subprocess
import os
import tempfile
import re

# ── Page config ───────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Resume Tailor",
    page_icon="📄",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@300;400;600&display=swap');
html, body, [class*="css"] { font-family: 'IBM Plex Sans', sans-serif; }
.stApp { background-color: #0f1117; color: #e8e8e8; }
h1, h2, h3 { font-family: 'IBM Plex Mono', monospace !important; letter-spacing: -0.02em; }
.hero-title { font-family: 'IBM Plex Mono', monospace; font-size: 2.4rem; font-weight: 600; color: #f0f0f0; border-left: 4px solid #4ade80; padding-left: 1rem; margin-bottom: 0.25rem; line-height: 1.2; }
.hero-sub { font-family: 'IBM Plex Sans', sans-serif; font-weight: 300; color: #888; font-size: 1rem; padding-left: 1.25rem; margin-bottom: 2rem; }
.badge { display: inline-block; background: #1a2e1a; color: #4ade80; border: 1px solid #2d5a2d; border-radius: 4px; padding: 2px 10px; font-family: 'IBM Plex Mono', monospace; font-size: 0.7rem; margin-bottom: 1.5rem; }
.output-box { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1.5rem; font-family: 'IBM Plex Mono', monospace; font-size: 0.82rem; line-height: 1.7; color: #c9d1d9; white-space: pre-wrap; max-height: 500px; overflow-y: auto; }
.warning-box { background: #1a1505; border: 1px solid #5a4a00; border-radius: 6px; padding: 0.75rem 1rem; color: #fbbf24; font-size: 0.85rem; margin-bottom: 1rem; }
.info-box { background: #0d1f2d; border: 1px solid #1e3a5f; border-radius: 6px; padding: 0.75rem 1rem; color: #60a5fa; font-size: 0.85rem; margin-bottom: 1rem; }
.stButton > button { background: #4ade80; color: #0a0a0a; font-family: 'IBM Plex Mono', monospace; font-weight: 600; border: none; border-radius: 6px; padding: 0.6rem 1.5rem; font-size: 0.9rem; transition: all 0.2s; width: 100%; }
.stButton > button:hover { background: #86efac; transform: translateY(-1px); }
.stTextArea textarea { background: #161b22 !important; border: 1px solid #30363d !important; border-radius: 6px !important; color: #c9d1d9 !important; font-family: 'IBM Plex Mono', monospace !important; font-size: 0.82rem !important; }
.stTextArea label, .stSelectbox label, .stTextInput label { color: #8b949e !important; font-family: 'IBM Plex Mono', monospace !important; font-size: 0.8rem !important; text-transform: uppercase !important; letter-spacing: 0.08em !important; }
.copy-tip { font-size: 0.75rem; color: #555; text-align: right; margin-top: 0.25rem; font-family: 'IBM Plex Mono', monospace; }
[data-testid="stSidebar"] { background: #0d1117 !important; border-right: 1px solid #21262d; }
</style>
""", unsafe_allow_html=True)

# ── Script paths ───────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
COVER_SCRIPT = os.path.join(SCRIPT_DIR, "generate_cover_letter.js")
RESUME_SCRIPT = os.path.join(SCRIPT_DIR, "generate_resume.js")

# ── Ollama Cloud API ───────────────────────────────────────────────────────────
def call_ollama(prompt: str, model: str, api_key: str, system: str = "") -> str:
    url = "https://api.ollama.ai/api/chat"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    payload = {"model": model, "messages": messages, "stream": False,
                "options": {"temperature": 0.3, "top_p": 0.85}}
    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=120)
        resp.raise_for_status()
        return resp.json()["message"]["content"]
    except requests.exceptions.HTTPError:
        st.error(f"API error {resp.status_code}: {resp.text}")
        return ""
    except Exception as e:
        st.error(f"Request failed: {e}")
        return ""


SYSTEM_STRICT = """You are a professional resume and cover letter writer.

CRITICAL RULES — follow these without exception:
1. NEVER invent, fabricate, or embellish any information.
2. ONLY use facts explicitly stated in the resume provided by the user.
3. You may REORDER, REFRAME, and EMPHASIZE existing content to better match the job description.
4. You may use strong action verbs — but every claim must trace back to the original resume.
5. If the resume lacks a skill or experience the job requires, DO NOT add it.
6. Do not add fake metrics, dates, companies, titles, certifications, or technologies not in the original resume.

Your job is to make the candidate's REAL experience shine — not to invent a better candidate."""


def resume_json_prompt(resume, job_desc, name, contact):
    return f"""Rewrite this resume tailored to the job description. Return ONLY valid JSON — no markdown, no explanation.

JSON SCHEMA:
{{
  "name": "{name}",
  "contact": "{contact}",
  "sections": [
    {{"heading": "SUMMARY", "type": "paragraph", "content": "..."}},
    {{"heading": "EXPERIENCE", "type": "jobs", "jobs": [
      {{"title": "...", "org": "...", "location": "...", "dates": "...", "bullets": ["..."]}}
    ]}},
    {{"heading": "EDUCATION", "type": "education", "items": [
      {{"degree": "...", "institution": "...", "year": "..."}}
    ]}},
    {{"heading": "SKILLS", "type": "skills", "content": "..."}}
  ]
}}

Use **bold** markers for inline emphasis. Only include sections present in the original resume.

---ORIGINAL RESUME---
{resume}

---JOB DESCRIPTION---
{job_desc}

---JSON OUTPUT---"""


def cover_json_prompt(resume, job_desc, tone, name, contact):
    return f"""Write a cover letter using ONLY facts from the resume. Return ONLY valid JSON — no markdown, no explanation.
Tone: {tone}. Under 450 words. 3-4 body paragraphs or bullets.

JSON SCHEMA:
{{
  "name": "{name}",
  "contact": "{contact}",
  "salutation": "Dear Hiring Committee,",
  "opening": "...",
  "transition": "...",
  "bullets": [
    {{"label": "Bold Label", "text": "Description using only resume facts."}}
  ],
  "closing": "...",
  "penultimate": "...",
  "sign_off": "Sincerely,",
  "signature": "{name.title()}"
}}

Use **bold** markers for inline emphasis. bullets array can be empty [] if not appropriate.

---RESUME---
{resume}

---JOB DESCRIPTION---
{job_desc}

---JSON OUTPUT---"""


def json_to_docx(json_data: dict, script_path: str) -> bytes | None:
    with tempfile.TemporaryDirectory() as tmpdir:
        json_path = os.path.join(tmpdir, "input.json")
        docx_path = os.path.join(tmpdir, "output.docx")
        with open(json_path, "w") as f:
            json.dump(json_data, f, ensure_ascii=False)
        result = subprocess.run(["node", script_path, json_path, docx_path],
                                capture_output=True, text=True)
        if result.returncode != 0:
            st.error(f"docx generation error:\n{result.stderr}")
            return None
        if os.path.exists(docx_path):
            return open(docx_path, "rb").read()
    return None


def safe_parse_json(text: str) -> dict | None:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        st.error(f"Could not parse model JSON output: {e}")
        with st.expander("Raw model output (for debugging)"):
            st.code(text[:2000])
        return None


# ── Sidebar ────────────────────────────────────────────────────────────────────
with st.sidebar:
    st.markdown('<div class="hero-title">⚙ Config</div>', unsafe_allow_html=True)
    api_key = st.text_input("Ollama Cloud API Key", type="password", placeholder="ollama_...")
    model = st.selectbox("Model", [
        "llama3.3:70b", "llama3.1:70b", "mistral:7b", "gemma3:27b", "qwen2.5:72b"
    ], index=0)
    tone = st.selectbox("Cover Letter Tone", [
        "Professional", "Enthusiastic", "Concise / Direct", "Academic / Formal"
    ])
    candidate_name = st.text_input("Your Name", placeholder="RYAN M. KMETZ")
    contact_line = st.text_input("Contact Line", placeholder="City, ST | email | phone | website | github")
    st.markdown("---")
    st.markdown("""<div style="font-size:0.75rem;color:#555;font-family:'IBM Plex Mono',monospace;line-height:1.6">
    🔒 API key never stored.<br>📄 Output: .docx matching your template.<br>🚫 Temp 0.3 — minimal hallucination.
    </div>""", unsafe_allow_html=True)


# ── Main UI ────────────────────────────────────────────────────────────────────
st.markdown('<div class="hero-title">Resume Tailor</div>', unsafe_allow_html=True)
st.markdown('<div class="hero-sub">Paste your resume + a job description → tailored resume & cover letter as .docx. No hallucinations — only your real experience, reframed.</div>', unsafe_allow_html=True)
st.markdown('<div class="badge">✦ Powered by Ollama Cloud · .docx output · Zero fabrication policy</div>', unsafe_allow_html=True)

col1, col2 = st.columns(2, gap="large")
with col1:
    resume_text = st.text_area("Your Resume", height=420,
        placeholder="Paste your full resume here as plain text...")
with col2:
    job_desc_text = st.text_area("Job Description", height=420,
        placeholder="Paste the full job posting here...")

ready = bool(api_key and resume_text.strip() and job_desc_text.strip() and candidate_name.strip())

if not api_key:
    st.markdown('<div class="info-box">👈 Add your Ollama Cloud API key in the sidebar.</div>', unsafe_allow_html=True)
if not candidate_name:
    st.markdown('<div class="info-box">👈 Enter your name in the sidebar for the document header.</div>', unsafe_allow_html=True)
if resume_text and len(resume_text.strip()) < 100:
    st.markdown('<div class="warning-box">⚠ Resume looks short — paste the full text for best results.</div>', unsafe_allow_html=True)

run_col, _ = st.columns([1, 3])
with run_col:
    go = st.button("✦ Tailor My Resume", disabled=not ready)

# ── Generation ─────────────────────────────────────────────────────────────────
if go:
    st.markdown("---")
    name = candidate_name.strip()
    contact = contact_line.strip() if contact_line.strip() else name

    # Resume
    with st.spinner("Rewriting resume…"):
        t0 = time.time()
        raw_resume = call_ollama(resume_json_prompt(resume_text, job_desc_text, name, contact),
                                 model, api_key, SYSTEM_STRICT)
        resume_time = round(time.time() - t0, 1)

    resume_json = safe_parse_json(raw_resume) if raw_resume else None
    if resume_json:
        with st.spinner("Building resume .docx…"):
            resume_docx = json_to_docx(resume_json, RESUME_SCRIPT)
        st.markdown("### 📄 Tailored Resume")
        st.markdown(f'<div class="copy-tip">Generated in {resume_time}s · {model}</div>', unsafe_allow_html=True)
        with st.expander("Preview structured data"):
            st.json(resume_json)
        if resume_docx:
            st.download_button("⬇ Download Tailored Resume (.docx)", data=resume_docx,
                file_name="tailored_resume.docx",
                mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        st.markdown("")

    # Cover Letter
    with st.spinner("Writing cover letter…"):
        t0 = time.time()
        raw_cover = call_ollama(cover_json_prompt(resume_text, job_desc_text, tone, name, contact),
                                model, api_key, SYSTEM_STRICT)
        cover_time = round(time.time() - t0, 1)

    cover_json = safe_parse_json(raw_cover) if raw_cover else None
    if cover_json:
        with st.spinner("Building cover letter .docx…"):
            cover_docx = json_to_docx(cover_json, COVER_SCRIPT)
        st.markdown("### ✉ Cover Letter")
        st.markdown(f'<div class="copy-tip">Generated in {cover_time}s · tone: {tone}</div>', unsafe_allow_html=True)
        with st.expander("Preview structured data"):
            st.json(cover_json)
        if cover_docx:
            st.download_button("⬇ Download Cover Letter (.docx)", data=cover_docx,
                file_name="cover_letter.docx",
                mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document")

    if not resume_json and not cover_json:
        st.error("Both outputs failed. Check your API key, model name, and try again.")
