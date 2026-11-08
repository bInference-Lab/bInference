import type { PdfOperationShapes } from "../operations/pdf-operations.schema.js";
import { ids, type WireExample } from "./wire-values.js";

/** Example calls of the operations the agent reads PDFs with (decision 0402). */
export const pdfExamples: { readonly [N in keyof PdfOperationShapes]: WireExample } = {
  "pdf/read": {
    args: { agent: ids.agent, path: "~/Downloads/whitepaper.pdf", pages: [1, 2] },
    result: {
      document: "9f2c4e1a7b3d5e60",
      totalPages: 12,
      pages: [
        { page: 1, text: "Token Whitepaper\nSupply: 1,000,000,000" },
        { page: 2, text: "", image: { contentType: "image/jpeg", bytes: 182_044 } },
      ],
      textCut: false,
      pagesCut: false,
      imagesCut: false,
    },
  },
  "pdf/pageImage": {
    args: { agent: ids.agent, document: "9f2c4e1a7b3d5e60", page: 2 },
    result: { contentType: "image/jpeg", bytes: 4, offset: 0, data: "/9j/4A==" },
  },
};
