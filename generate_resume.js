#!/usr/bin/env node
/**
 * generate_resume.js
 * Produces a tailored_resume.docx matching Ryan Kmetz's formatting style.
 *
 * Usage:
 *   node generate_resume.js <json_input_file> <output_docx>
 *
 * JSON schema:
 * {
 *   "name": "RYAN M. KMETZ",
 *   "contact": "Baltimore, MD | kmetzrm@gmail.com | +1 757.470.4010 | ryankmetz.com | github.com/rmkenv",
 *   "sections": [
 *     {
 *       "heading": "SUMMARY",
 *       "type": "paragraph",       // or "bullets" or "skills"
 *       "content": "Text here..."  // for paragraph
 *     },
 *     {
 *       "heading": "EXPERIENCE",
 *       "type": "jobs",
 *       "jobs": [
 *         {
 *           "title": "Senior Data Scientist",
 *           "org": "Maryland Energy Administration",
 *           "location": "Baltimore, MD",
 *           "dates": "2021–Present",
 *           "bullets": ["Led ...", "Developed ..."]
 *         }
 *       ]
 *     },
 *     {
 *       "heading": "SKILLS",
 *       "type": "bullets",
 *       "items": ["Python", "GIS", ...]
 *     }
 *   ]
 * }
 */

const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun,
  AlignmentType, LevelFormat, BorderStyle,
  WidthType, TabStopType, TabStopPosition,
} = require("docx");

const inputFile = process.argv[2];
const outputFile = process.argv[3];

if (!inputFile || !outputFile) {
  console.error("Usage: node generate_resume.js <input.json> <output.docx>");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(inputFile, "utf8"));

const BODY_FONT = "Calibri";
const BODY_SIZE = 22;  // 11pt
const SMALL_SIZE = 20; // 10pt

// ── Inline bold parser ────────────────────────────────────────────────────────
function parseBold(text, baseOpts = {}) {
  const runs = [];
  const regex = /\*\*(.+?)\*\*/g;
  let last = 0, m;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) runs.push(new TextRun({ text: text.slice(last, m.index), ...baseOpts }));
    runs.push(new TextRun({ text: m[1], bold: true, ...baseOpts }));
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push(new TextRun({ text: text.slice(last), ...baseOpts }));
  return runs;
}

// ── Section divider line ──────────────────────────────────────────────────────
function sectionHeading(label) {
  return new Paragraph({
    spacing: { before: 240, after: 60 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: "2E75B6", space: 1 },
    },
    children: [
      new TextRun({
        text: label.toUpperCase(),
        bold: true,
        size: 24,
        font: BODY_FONT,
        color: "2E75B6",
      }),
    ],
  });
}

const numbering = {
  config: [
    {
      reference: "resume-bullets",
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

function bulletPara(text) {
  return new Paragraph({
    numbering: { reference: "resume-bullets", level: 0 },
    children: parseBold(text, { font: BODY_FONT, size: BODY_SIZE }),
    spacing: { before: 40, after: 40 },
  });
}

// ── Build document body ───────────────────────────────────────────────────────
const children = [];

// Name
children.push(
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 40 },
    children: [
      new TextRun({ text: data.name, bold: true, size: 32, font: BODY_FONT }),
    ],
  })
);

// Contact
children.push(
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 240 },
    children: [
      new TextRun({ text: data.contact, size: SMALL_SIZE, font: BODY_FONT }),
    ],
  })
);

// Sections
for (const section of data.sections) {
  children.push(sectionHeading(section.heading));

  if (section.type === "paragraph") {
    children.push(
      new Paragraph({
        spacing: { before: 0, after: 120 },
        children: parseBold(section.content, { font: BODY_FONT, size: BODY_SIZE }),
      })
    );
  }

  else if (section.type === "bullets") {
    for (const item of section.items) {
      children.push(bulletPara(item));
    }
  }

  else if (section.type === "skills") {
    // Comma-separated inline or short bullets
    children.push(
      new Paragraph({
        spacing: { before: 0, after: 120 },
        children: parseBold(section.content, { font: BODY_FONT, size: BODY_SIZE }),
      })
    );
  }

  else if (section.type === "jobs") {
    for (const job of section.jobs) {
      // Job title | Org — right-aligned dates using tab stop
      const CONTENT_WIDTH = 9360; // 9360 DXA = 6.5 inches (US Letter 1" margins)
      children.push(
        new Paragraph({
          spacing: { before: 120, after: 0 },
          tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH }],
          children: [
            new TextRun({ text: job.title, bold: true, font: BODY_FONT, size: BODY_SIZE }),
            new TextRun({ text: " | ", font: BODY_FONT, size: BODY_SIZE }),
            new TextRun({ text: job.org, font: BODY_FONT, size: BODY_SIZE }),
            new TextRun({ text: "\t", font: BODY_FONT, size: BODY_SIZE }),
            new TextRun({ text: job.dates, font: BODY_FONT, size: BODY_SIZE, italics: true }),
          ],
        })
      );
      // Location
      if (job.location) {
        children.push(
          new Paragraph({
            spacing: { before: 0, after: 60 },
            children: [
              new TextRun({ text: job.location, font: BODY_FONT, size: SMALL_SIZE, italics: true, color: "666666" }),
            ],
          })
        );
      }
      // Bullets
      for (const b of (job.bullets || [])) {
        children.push(bulletPara(b));
      }
    }
  }

  else if (section.type === "education") {
    for (const edu of section.items) {
      children.push(
        new Paragraph({
          spacing: { before: 120, after: 0 },
          children: [
            new TextRun({ text: edu.degree, bold: true, font: BODY_FONT, size: BODY_SIZE }),
            new TextRun({ text: " — ", font: BODY_FONT, size: BODY_SIZE }),
            new TextRun({ text: edu.institution, font: BODY_FONT, size: BODY_SIZE }),
            new TextRun({ text: edu.year ? `  (${edu.year})` : "", font: BODY_FONT, size: BODY_SIZE, color: "666666" }),
          ],
        })
      );
      if (edu.details) {
        children.push(
          new Paragraph({
            spacing: { before: 0, after: 80 },
            children: [new TextRun({ text: edu.details, font: BODY_FONT, size: SMALL_SIZE, color: "555555" })],
          })
        );
      }
    }
  }
}

// ── Assemble ──────────────────────────────────────────────────────────────────
const doc = new Document({
  numbering,
  sections: [
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 }, // 0.75" margins for resumes
        },
      },
      children,
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outputFile, buf);
  console.log(`Written: ${outputFile}`);
});
