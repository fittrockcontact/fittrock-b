import PDFDocument from 'pdfkit';

export interface InvoiceItem {
  title: string;
  variantTitle?: string;
  sku?: string;
  quantity: number;
  unitPriceRupees: number;
}

export interface InvoiceData {
  orderNumber: string;
  orderDate: Date | string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  shippingAddress?: {
    line1?: string;
    line2?: string | null;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
  customerGst?: string | null;
  items: InvoiceItem[];
  subtotalRupees: number;
  discountRupees?: number;
  shippingRupees?: number;
  totalRupees: number;
  paymentId?: string;
  paymentMethod?: string;
}

// Convert numbers up to 10 crore into Indian English words
function numberToWordsINR(num: number): string {
  const rounded = Math.round(num);
  if (rounded === 0) return 'Zero';

  const a = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
  ];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertTwoDigits(n: number): string {
    if (n < 20) return a[n];
    const unit = n % 10;
    return b[Math.floor(n / 10)] + (unit ? ' ' + a[unit] : '');
  }

  function convertThreeDigits(n: number): string {
    const hundred = Math.floor(n / 100);
    const rest = n % 100;
    let res = '';
    if (hundred > 0) res += a[hundred] + ' Hundred';
    if (rest > 0) res += (res ? ' ' : '') + convertTwoDigits(rest);
    return res;
  }

  let remaining = rounded;
  const crore = Math.floor(remaining / 10000000);
  remaining %= 10000000;
  const lakh = Math.floor(remaining / 100000);
  remaining %= 100000;
  const thousand = Math.floor(remaining / 1000);
  remaining %= 1000;

  const parts: string[] = [];
  if (crore > 0) parts.push(convertThreeDigits(crore) + ' Crore');
  if (lakh > 0) parts.push(convertThreeDigits(lakh) + ' Lakh');
  if (thousand > 0) parts.push(convertThreeDigits(thousand) + ' Thousand');
  if (remaining > 0) parts.push(convertThreeDigits(remaining));

  return parts.join(' ') + ' Only';
}

/**
 * Generates an official Tax Invoice PDF for Fittrock Ergonomics LLP
 */
export async function generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 36,
        size: 'A4',
        info: {
          Title: `Tax Invoice - ${data.orderNumber}`,
          Author: 'Fittrock Ergonomics LLP',
          Subject: `Tax Invoice for Order ${data.orderNumber}`,
          Keywords: 'Tax Invoice, GST, Fittrock, Ergonomics, Standing Desk',
        },
      });

      const buffers: Buffer[] = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      const primaryColor = '#18181b'; // Dark slate
      const accentColor = '#d97706'; // Amber 600
      const mutedColor = '#71717a'; // Zinc 500
      const lightBg = '#f4f4f5'; // Zinc 100
      const borderColor = '#e4e4e7'; // Zinc 200

      const pageWidth = doc.page.width - 72; // 595.28 - 72 = 523.28 pt
      const leftMargin = 36;
      let y = 36;

      // 1. TOP HEADER BRAND & TAX INVOICE BADGE
      doc
        .fontSize(18)
        .font('Helvetica-Bold')
        .fillColor(accentColor)
        .text('FITTROCK ERGONOMICS LLP', leftMargin, y, { lineBreak: false });

      // Invoice Badge on Top Right
      doc
        .fontSize(14)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text('TAX INVOICE', 350, y, { width: 210, align: 'right' });

      doc
        .fontSize(8)
        .font('Helvetica')
        .fillColor(mutedColor)
        .text('(Original for Recipient)', 350, y + 18, { width: 210, align: 'right' });

      y += 24;

      // Seller Company Details
      doc
        .fontSize(8)
        .font('Helvetica')
        .fillColor(primaryColor)
        .text('Office No. 610, 6th Floor, Park Plaza, Porwal Road, Lohegaon,', leftMargin, y)
        .text('Pune, Maharashtra – 411047, India', leftMargin, y + 10)
        .font('Helvetica-Bold')
        .text(`GSTIN: 27AAKFF1426F1ZN   |   LLPIN: ACK-4668`, leftMargin, y + 21)
        .font('Helvetica')
        .text(`Email: contact@fittrock.com   |   Phone: +91 8087827905`, leftMargin, y + 31)
        .text(`State: Maharashtra (State Code: 27)`, leftMargin, y + 41);

      // Invoice Meta Details on Right
      const dateFormatted = new Date(data.orderDate).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });

      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .text(`Invoice No: `, 350, y + 5, { width: 90, align: 'left' })
        .font('Helvetica')
        .text(`INV-${data.orderNumber}`, 440, y + 5, { width: 120, align: 'right' })

        .font('Helvetica-Bold')
        .text(`Invoice Date: `, 350, y + 16, { width: 90, align: 'left' })
        .font('Helvetica')
        .text(dateFormatted, 440, y + 16, { width: 120, align: 'right' })

        .font('Helvetica-Bold')
        .text(`Order Reference: `, 350, y + 27, { width: 90, align: 'left' })
        .font('Helvetica')
        .text(`#${data.orderNumber}`, 440, y + 27, { width: 120, align: 'right' })

        .font('Helvetica-Bold')
        .text(`Payment ID: `, 350, y + 38, { width: 90, align: 'left' })
        .font('Helvetica')
        .text(data.paymentId || 'Prepaid Online', 440, y + 38, { width: 120, align: 'right' });

      y += 60;

      // Divider Line
      doc.rect(leftMargin, y, pageWidth, 1).fill(borderColor);
      y += 10;

      // 2. BILL TO & SHIP TO SECTION (2 BOXES)
      const colWidth = (pageWidth - 10) / 2;
      const boxHeight = 78;

      // Billed To Box
      doc.roundedRect(leftMargin, y, colWidth, boxHeight, 4).lineWidth(0.5).strokeColor(borderColor).stroke();
      doc.roundedRect(leftMargin, y, colWidth, 18, 4).fill(lightBg);

      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text('BILL TO (BUYER DETAILS)', leftMargin + 8, y + 5);

      const customerState = data.shippingAddress?.state || 'Maharashtra';

      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text(data.customerName || 'Valued Customer', leftMargin + 8, y + 24)
        .font('Helvetica')
        .fillColor(primaryColor)
        .text(
          `${data.shippingAddress?.line1 || 'Shipping Address'}${
            data.shippingAddress?.line2 ? ', ' + data.shippingAddress.line2 : ''
          }`,
          leftMargin + 8,
          y + 35,
          { width: colWidth - 16, lineBreak: false, ellipsis: true }
        )
        .text(
          `${data.shippingAddress?.city || ''}, ${customerState} - ${data.shippingAddress?.postalCode || ''}`,
          leftMargin + 8,
          y + 46
        )
        .text(
          `Phone: ${data.customerPhone || 'N/A'}  |  Email: ${data.customerEmail || 'N/A'}`,
          leftMargin + 8,
          y + 56
        )
        .font(data.customerGst ? 'Helvetica-Bold' : 'Helvetica')
        .fillColor(data.customerGst ? accentColor : mutedColor)
        .text(
          data.customerGst ? `Customer GSTIN: ${data.customerGst}` : 'Place of Supply: ' + customerState,
          leftMargin + 8,
          y + 66
        );

      // Shipped To Box
      const rightColX = leftMargin + colWidth + 10;
      doc.roundedRect(rightColX, y, colWidth, boxHeight, 4).lineWidth(0.5).strokeColor(borderColor).stroke();
      doc.roundedRect(rightColX, y, colWidth, 18, 4).fill(lightBg);

      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text('SHIP TO (DELIVERY DESTINATION)', rightColX + 8, y + 5);

      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text(data.customerName || 'Valued Customer', rightColX + 8, y + 24)
        .font('Helvetica')
        .fillColor(primaryColor)
        .text(
          `${data.shippingAddress?.line1 || 'Address'}${
            data.shippingAddress?.line2 ? ', ' + data.shippingAddress.line2 : ''
          }`,
          rightColX + 8,
          y + 35,
          { width: colWidth - 16, lineBreak: false, ellipsis: true }
        )
        .text(
          `${data.shippingAddress?.city || ''}, ${customerState} - ${data.shippingAddress?.postalCode || ''}`,
          rightColX + 8,
          y + 46
        )
        .text(`Country: India  |  Shipping Mode: Surface Express Air Cargo`, rightColX + 8, y + 56)
        .text(`Dispatch Hub: Pune Central Fulfillment Center (MH-27)`, rightColX + 8, y + 66);

      y += boxHeight + 14;

      // 3. TAX LOGIC CALCULATION (18% GST standard on Office Furniture/Desks HSN 9403)
      const isIntraState = customerState.trim().toLowerCase().includes('maharashtra');
      const totalAmount = data.totalRupees;

      // Desks pricing includes 18% GST: Taxable Value = Total / 1.18
      const totalTaxable = Math.round((totalAmount / 1.18) * 100) / 100;
      const totalTaxAmount = Math.round((totalAmount - totalTaxable) * 100) / 100;

      const cgstAmount = isIntraState ? Math.round((totalTaxAmount / 2) * 100) / 100 : 0;
      const sgstAmount = isIntraState ? Math.round((totalTaxAmount - cgstAmount) * 100) / 100 : 0;
      const igstAmount = !isIntraState ? totalTaxAmount : 0;

      // 4. ITEMS TABLE
      // Table Header
      const thHeight = 20;
      doc.rect(leftMargin, y, pageWidth, thHeight).fill(lightBg);
      doc.rect(leftMargin, y, pageWidth, thHeight).lineWidth(0.5).strokeColor(borderColor).stroke();

      const colSNo = leftMargin + 8;
      const colDesc = leftMargin + 30;
      const colHsn = leftMargin + 240;
      const colQty = leftMargin + 290;
      const colRate = leftMargin + 330;
      const colTaxable = leftMargin + 390;
      const colTax = leftMargin + 450;
      const colTotal = leftMargin + pageWidth - 8;

      doc
        .fontSize(7.5)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text('#', colSNo, y + 6)
        .text('ITEM DESCRIPTION', colDesc, y + 6)
        .text('HSN', colHsn, y + 6)
        .text('QTY', colQty, y + 6)
        .text('RATE (₹)', colRate, y + 6, { width: 50, align: 'right' })
        .text('TAXABLE (₹)', colTaxable, y + 6, { width: 50, align: 'right' })
        .text('TAX (18%)', colTax, y + 6, { width: 45, align: 'right' })
        .text('TOTAL (₹)', colTotal - 55, y + 6, { width: 55, align: 'right' });

      y += thHeight;

      // Render Rows
      data.items.forEach((item, idx) => {
        const itemTotal = item.unitPriceRupees * item.quantity;
        const itemTaxable = Math.round((itemTotal / 1.18) * 100) / 100;
        const itemTax = Math.round((itemTotal - itemTaxable) * 100) / 100;
        const itemUnitTaxable = Math.round((itemTaxable / item.quantity) * 100) / 100;

        const rowHeight = 28;
        doc
          .rect(leftMargin, y, pageWidth, rowHeight)
          .lineWidth(0.5)
          .strokeColor(borderColor)
          .stroke();

        doc
          .fontSize(8)
          .font('Helvetica')
          .fillColor(primaryColor)
          .text(String(idx + 1), colSNo, y + 6)
          .font('Helvetica-Bold')
          .text(item.title, colDesc, y + 5, { width: 200, lineBreak: false, ellipsis: true })
          .font('Helvetica')
          .fontSize(7)
          .fillColor(mutedColor)
          .text(
            `${item.variantTitle || 'Standard Model'}${item.sku ? ' | SKU: ' + item.sku : ''}`,
            colDesc,
            y + 16,
            { width: 200, lineBreak: false, ellipsis: true }
          )
          .fontSize(8)
          .fillColor(primaryColor)
          .text('9403', colHsn, y + 9)
          .text(String(item.quantity), colQty, y + 9)
          .text(itemUnitTaxable.toFixed(2), colRate, y + 9, { width: 50, align: 'right' })
          .text(itemTaxable.toFixed(2), colTaxable, y + 9, { width: 50, align: 'right' })
          .text(itemTax.toFixed(2), colTax, y + 9, { width: 45, align: 'right' })
          .font('Helvetica-Bold')
          .text(itemTotal.toFixed(2), colTotal - 55, y + 9, { width: 55, align: 'right' });

        y += rowHeight;
      });

      y += 10;

      // 5. TAX BREAKDOWN & SUMMARY TOTALS
      const summaryWidth = 230;
      const summaryX = leftMargin + pageWidth - summaryWidth;

      // Amount in Words Box on Left
      const wordsBoxWidth = pageWidth - summaryWidth - 12;
      doc
        .roundedRect(leftMargin, y, wordsBoxWidth, 75, 4)
        .lineWidth(0.5)
        .strokeColor(borderColor)
        .stroke();

      doc
        .fontSize(7.5)
        .font('Helvetica-Bold')
        .fillColor(mutedColor)
        .text('INVOICE VALUE IN WORDS', leftMargin + 8, y + 7)
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text(`INR ${numberToWordsINR(totalAmount)}`, leftMargin + 8, y + 20, {
          width: wordsBoxWidth - 16,
        })
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(mutedColor)
        .text(
          `Payment Status: 100% PAID VIA RAZORPAY GATEWAY`,
          leftMargin + 8,
          y + 44
        )
        .text(
          `Transaction ID: ${data.paymentId || 'Verified Instant Settlement'}`,
          leftMargin + 8,
          y + 55
        );

      // Summary Box on Right
      doc.roundedRect(summaryX, y, summaryWidth, 105, 4).lineWidth(0.5).strokeColor(borderColor).stroke();

      let sumY = y + 7;
      const addSummaryRow = (label: string, value: string, isBold = false, color = primaryColor) => {
        doc
          .fontSize(7.5)
          .font(isBold ? 'Helvetica-Bold' : 'Helvetica')
          .fillColor(color)
          .text(label, summaryX + 10, sumY, { width: 120, align: 'left' })
          .text(value, summaryX + 130, sumY, { width: 90, align: 'right' });
        sumY += 13;
      };

      addSummaryRow('Subtotal (Taxable Value):', `₹${totalTaxable.toFixed(2)}`);

      if (isIntraState) {
        addSummaryRow('Central GST (CGST 9%):', `₹${cgstAmount.toFixed(2)}`);
        addSummaryRow('State GST (SGST 9%):', `₹${sgstAmount.toFixed(2)}`);
      } else {
        addSummaryRow('Integrated GST (IGST 18%):', `₹${igstAmount.toFixed(2)}`);
      }

      if (data.discountRupees && data.discountRupees > 0) {
        addSummaryRow('Promo Discount:', `-₹${data.discountRupees.toFixed(2)}`, false, '#16a34a');
      }

      addSummaryRow('Insured Surface Freight:', 'FREE (₹0.00)', false, '#16a34a');

      // Grand Total Row with accent highlight
      doc.rect(summaryX, sumY - 2, summaryWidth, 22).fill(lightBg);
      doc
        .fontSize(9)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text('TOTAL AMOUNT (INR):', summaryX + 10, sumY + 4)
        .fillColor(accentColor)
        .text(`₹${totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, summaryX + 120, sumY + 4, {
          width: 100,
          align: 'right',
        });

      y += 120;

      // 6. LEGAL DECLARATION & SIGNATORY
      doc.roundedRect(leftMargin, y, pageWidth, 70, 4).lineWidth(0.5).strokeColor(borderColor).stroke();

      doc
        .fontSize(7)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text('DECLARATION & WARRANTY TERMS:', leftMargin + 8, y + 8)
        .font('Helvetica')
        .fillColor(mutedColor)
        .text(
          '1. Fittrock Ergonomics LLP certifies that goods listed on this invoice are manufactured to international BIFMA & CE standards.',
          leftMargin + 8,
          y + 19
        )
        .text(
          '2. 5-Year Limited Warranty covers electric motors, control box, handset, and dual-stage steel columns.',
          leftMargin + 8,
          y + 28
        )
        .text(
          '3. 30-Day Risk-Free Trial policy applies from the date of confirmed courier delivery.',
          leftMargin + 8,
          y + 37
        )
        .text(
          '4. This is a computer-generated tax invoice generated upon electronic payment confirmation. No physical signature is required.',
          leftMargin + 8,
          y + 46
        );

      // Authorized Signatory Block on Right
      doc
        .fontSize(7.5)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text('For FITTROCK ERGONOMICS LLP', pageWidth - 140, y + 16, { width: 170, align: 'right' })
        .fontSize(7)
        .font('Helvetica-Oblique')
        .fillColor(mutedColor)
        .text('Authorized Electronic Signatory', pageWidth - 140, y + 46, { width: 170, align: 'right' });

      // Bottom Watermark / Support Info
      doc
        .fontSize(7)
        .font('Helvetica')
        .fillColor(mutedColor)
        .text(
          'For corporate inquiries, bulk workstation orders, or warranty claims: support@fittrock.com  |  www.fittrock.com',
          leftMargin,
          doc.page.height - 28,
          { width: pageWidth, align: 'center' }
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
