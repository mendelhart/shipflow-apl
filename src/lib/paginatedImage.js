/**
 * Draw one tall canvas across as many PDF pages as it needs.
 *
 * The obvious implementation — redraw the whole image on every page, shifted up
 * by one page each time — is what both callers used, and it silently duplicates
 * content. jsPDF clips to the PAGE, not to the margin box, so the strip between
 * y=0 and y=margin on page 2 shows the tail of page 1's band, and the strip
 * below the bottom margin shows the head of page 3's. That is 2 x margin of
 * repeated content at every page break: on a customs invoice, a line item
 * printed at the bottom of one page and again at the top of the next.
 *
 * Painting the margins white after each draw removes it, and keeps the margins
 * the callers already lay out for.
 */
export function addPaginatedImage(pdf, imgData, { margin = 20, format = 'JPEG' } = {}) {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const contentW = pageW - margin * 2;
  const pageContentH = pageH - margin * 2;

  const props = pdf.getImageProperties(imgData);
  const imgH = (props.height * contentW) / props.width;

  let heightLeft = imgH;
  let position = margin;
  let first = true;

  while (heightLeft > 0) {
    if (!first) pdf.addPage();
    pdf.addImage(imgData, format, margin, position, contentW, imgH, undefined, 'FAST');

    // Mask everything outside the content box so no band appears twice.
    pdf.setFillColor(255, 255, 255);
    pdf.rect(0, 0, pageW, margin, 'F');                       // above
    pdf.rect(0, pageH - margin, pageW, margin, 'F');          // below
    pdf.rect(0, 0, margin, pageH, 'F');                       // left
    pdf.rect(pageW - margin, 0, margin, pageH, 'F');          // right

    heightLeft -= pageContentH;
    position -= pageContentH;
    first = false;
  }

  return pdf;
}
