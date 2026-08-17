export function parseWarehouseReport(text) {
  if (!text || !text.trim()) return null;

  const lines = text.split(/\r?\n/);
  const norm = (s) => s.replace(/[\s_-]/g, "").toLowerCase();

  // Find header row containing "ItemNumber"
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("\t") && norm(lines[i]).includes("itemnumber")) {
      headerIdx = i;
      break;
    }
  }

  // Fallback: first line with 5+ tabs
  if (headerIdx === -1) {
    headerIdx = lines.findIndex((l) => (l.match(/\t/g) || []).length >= 5);
  }
  if (headerIdx === -1) return null;

  const headers = lines[headerIdx].split("\t").map((h) => h.trim()).filter((h) => h);
  if (headers.length < 3) return null;

  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if ((line.match(/\t/g) || []).length < 2) break;
    const values = line.split("\t");
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = (values[idx] || "").trim();
    });
    rows.push(row);
  }
  if (rows.length === 0) return null;

  const getField = (row, ...candidates) => {
    const normalized = candidates.map(norm);
    for (const key of Object.keys(row)) {
      if (normalized.includes(norm(key))) return row[key];
    }
    return "";
  };

  const firstRow = rows[0];

  const shipment = {
    transactionNumber: getField(firstRow, "TransactionNumber", "Transaction Number"),
    referenceNumber: getField(firstRow, "ReferenceNumber", "Reference Number"),
    purchaseOrderNumber: getField(
      firstRow,
      "PurchaseOrderNumber",
      "Purchase Order Number",
      "PONumber",
      "PO Number"
    ),
    shipToCompany: getField(firstRow, "ShipToCompany", "Ship To Company"),
    shipToAddress: getField(
      firstRow,
      "ShipToAddress",
      "Ship To Address",
      "ShipToAddress1",
      "Ship To Address 1"
    ),
    shipToCity: getField(firstRow, "ShipToCity", "Ship To City"),
    shipToState: getField(firstRow, "ShipToState", "Ship To State"),
    shipToZip: getField(firstRow, "ShipToZip", "Ship To Zip", "ShipToPostalCode", "Ship To Postal Code"),
    shipToCountry: getField(firstRow, "ShipToCountry", "Ship To Country"),
    totalCartons: getField(firstRow, "TotalCartons", "Total Cartons"),
    totalPallets: getField(firstRow, "TotalPallets", "Total Pallets"),
    totalWeight: getField(firstRow, "TotalWeight", "Total Weight"),
  };

  const lineItems = rows
    .map((row, idx) => ({
      index: idx,
      itemNumber: getField(row, "ItemNumber", "Item Number", "ItemCode", "Item Code", "SKU"),
      quantityShipped:
        parseFloat(getField(row, "ItemQuantityShipped", "Quantity Shipped", "Qty", "Quantity")) || 0,
      lotNumber: getField(row, "LotNumber", "Lot Number", "Lot"),
    }))
    .filter((li) => li.itemNumber);

  if (lineItems.length === 0) return null;

  return { shipment, lineItems };
}