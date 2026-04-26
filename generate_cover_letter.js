#!/usr/bin/env node
/**
 * generate_cover_letter.js
 * Produces a cover_letter.docx matching Ryan Kmetz's formatting style.
 *
 * Usage:
 *   node generate_cover_letter.js <json_input_file> <output_docx>
 *
 * JSON schema:
 * {
 *   "name": "RYAN M. KMETZ",
 *   "contact": "Baltimore, MD | kmetzrm@gmail.com | +1 757.470.4010 | ryankmetz.com | github.com/rmkenv",
 *   "salutation": "Dear Hiring Committee,",
 *   "opening": "I am excited to apply for the ... position ...",
 *   "transition": "In my career, I have ...",
 *   "bullets": [
 *     { "label": "AI Education & Research Support", "text": "At the CUNY ..." },
 *     ...
 *   ],
 *   "closing": "Johns Hopkins University's commitment...",
 *   "penultimate": "I would welcome the opportunity...",
 *   "sign_off": "Sincerely,",
 *   "signature": "Ryan Kmetz"
 * }
 */

const fs = require("fs");
const path = require("path");

const {
  Document, Packer, Paragraph, TextRun,
  AlignmentType, LevelFormat,
  BorderStyle, HeadingLevel,
  WidthType,
} = require("docx");

const inputFile = process.argv[2];
const outputFile = process.argv[3];

if (!inputFile || !outputFile) {
  console.error("Usage: node generate_cover_letter.js <input.json> <output.docx>");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(inputFile, "utf8"));

// ── Helper: parse inline bold markers **text** → TextRun array ──────────────
function parseBold(text, baseOpts = {}) {
  const runs = [];
  const regex = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) {
      runs.push(new TextRun({ text: text.slice(last, m.index), ...baseOpts }));
    }
    runs.push(new TextRun({ text: m[1], bold: true, ...baseOpts }));
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    runs.push(new TextRun({ text: text.slice(last), ...baseOpts }));
  }
  return runs;
}

// ── Spacing helpers ───────────────────────────────────────────────────────────
const BODY_FONT = "Calibri";
const BODY_SIZE = 22; // 11pt in half-points
const BODY_SPACING = { before: 0, after: 120, line: 276, lineRule: "auto" };

function bodyPara(textOrRuns, opts = {}) {
  const children = Array.isArray(textOrRuns)
    ? textOrRuns
    : parseBold(textOrRuns, { font: BODY_FONT, size: BODY_SIZE });
  return new Paragraph({
    children,
    spacing: BODY_SPACING,
    ...opts,
  });
}

// ── Build document ────────────────────────────────────────────────────────────
const children = [];

// ── Name header (bold, centered, slightly larger) ─────────────────────────────
children.push(
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 40 },
    children: [
      new TextRun({
        text: data.name,
        bold: true,
        size: 28,       // 14pt
        font: BODY_FONT,
      }),
    ],
  })
);

// ── Contact line (centered, normal weight) ────────────────────────────────────
children.push(
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 240 },
    children: [
      new TextRun({
        text: data.contact,
        size: BODY_SIZE,
        font: BODY_FONT,
      }),
    ],
  })
);

// ── Salutation ────────────────────────────────────────────────────────────────
children.push(bodyPara(data.salutation));
children.push(new Paragraph({ spacing: { before: 0, after: 80 } })); // small gap

// ── Opening paragraph ─────────────────────────────────────────────────────────
children.push(bodyPara(data.opening));
children.push(new Paragraph({ spacing: { before: 0, after: 80 } }));

// ── Transition sentence before bullets ───────────────────────────────────────
if (data.transition) {
  children.push(bodyPara(data.transition));
}

// ── Bullet points ─────────────────────────────────────────────────────────────
// Each bullet: bold label then colon then normal text
const doc_numbering = {
  config: [
    {
      reference: "cover-bullets",
      levels: [
        {
          level: 0,
          format: LevelFormat.BULLET,
          text: "\u2022",
          alignment: AlignmentType.LEFT,
          style: {
            paragraph: {
              indent: { left: 720, hanging: 360 },
            },
          },
        },
      ],
    },
  ],
};

for (const bullet of (data.bullets || [])) {
  const runs = [
    new TextRun({ text: bullet.label, bold: true, font: BODY_FONT, size: BODY_SIZE }),
    new TextRun({ text: ": ", font: BODY_FONT, size: BODY_SIZE }),
    ...parseBold(bullet.text, { font: BODY_FONT, size: BODY_SIZE }),
  ];
  children.push(
    new Paragraph({
      numbering: { reference: "cover-bullets", level: 0 },
      children: runs,
      spacing: { before: 80, after: 80 },
    })
  );
}

// ── Post-bullet spacing ───────────────────────────────────────────────────────
children.push(new Paragraph({ spacing: { before: 0, after: 80 } }));

// ── Closing paragraphs ────────────────────────────────────────────────────────
if (data.closing) {
  children.push(bodyPara(data.closing));
  children.push(new Paragraph({ spacing: { before: 0, after: 80 } }));
}
if (data.penultimate) {
  children.push(bodyPara(data.penultimate));
  children.push(new Paragraph({ spacing: { before: 0, after: 80 } }));
}

// ── Sign-off ──────────────────────────────────────────────────────────────────
children.push(bodyPara(data.sign_off));
children.push(new Paragraph({ spacing: { before: 0, after: 40 } }));
children.push(bodyPara(data.signature));

// ── Assemble document ─────────────────────────────────────────────────────────
const doc = new Document({
  numbering: doc_numbering,
  sections: [
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 }, // US Letter
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children,
    },
  ],
});

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(outputFile, buffer);
  console.log(`Written: ${outputFile}`);
});
