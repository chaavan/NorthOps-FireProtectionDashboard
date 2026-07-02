import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { authOptions } from "@/lib/auth";
import { enforceStandaloneEstimatePermission } from "@/lib/estimate/estimateAccess";
import { getStandaloneEstimate } from "@/lib/estimate/estimateService";
import EstimatePDFDocument from "@/components/estimate/EstimatePDFDocument";
import { loadEstimatePdfLogoDataUri } from "@/lib/estimate/estimatePdfLogo";

function filenameSafe(value: string) {
  return value
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "estimate";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    const access = await enforceStandaloneEstimatePermission(
      session,
      "estimates.pdf.generate",
      "export estimate PDFs",
    );
    if (!access.ok) {
      res.status(access.response.status).json(await access.response.json());
      return;
    }

    const estimateId = String(req.query.estimateId ?? "");
    if (!estimateId) {
      res.status(400).json({ error: "estimateId is required" });
      return;
    }

    const variantKey =
      typeof req.query.variantKey === "string" ? req.query.variantKey : null;

    const estimate = await getStandaloneEstimate({
      estimateId,
      variantKey,
      userEmail: access.userEmail,
    });

    if (!estimate.computed.parity.canExportPdf) {
      res.status(400).json({
        error:
          estimate.computed.parity.issues[0]?.message ||
          "Estimate PDF export is blocked until all material prices are resolved.",
        issues: estimate.computed.parity.issues,
      });
      return;
    }

    const logoDataUri = loadEstimatePdfLogoDataUri();
    const generatedAtDisplay = new Date().toLocaleString("en-US", {
      dateStyle: "long",
      timeStyle: "short",
    });
    const variantLabel =
      estimate.variant.variantLabel ||
      (estimate.variant.variantKey === "base" ? null : estimate.variant.variantKey);

    const pdfBuffer = await renderToBuffer(
      React.createElement(EstimatePDFDocument, {
        computed: estimate.computed,
        logoDataUri: logoDataUri ?? null,
        generatedAtDisplay,
        variantLabel,
        standaloneTitle: estimate.estimate.title,
      }) as React.ReactElement,
    );

    const variantSuffix =
      estimate.variant.variantKey && estimate.variant.variantKey !== "base"
        ? `-${estimate.variant.variantKey}`
        : "";

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${filenameSafe(estimate.estimate.title)}${variantSuffix}-estimate.pdf"`,
    );
    res.status(200).send(Buffer.from(pdfBuffer));
  } catch (error) {
    console.error("Error in pages/api estimate PDF:", error);
    res.status(500).json({ error: (error as Error).message });
  }
}
