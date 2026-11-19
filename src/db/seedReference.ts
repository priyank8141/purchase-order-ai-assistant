/**
 * Hand-written reference data for the seed. Supplier names are fixed (not faker)
 * because several are deliberately similar to exercise ambiguity handling.
 */

export interface SupplierRef {
  name: string;
  city: string;
  country: string;
  category: Category;
  /** Relative share of orders this supplier receives. */
  weight: number;
  /** Probability that a delivered order arrives late. Uneven on purpose so "most late deliveries" has a clear answer. */
  lateRate: number;
}

export type Category =
  | "General Trading"
  | "Metals"
  | "Packaging"
  | "Machinery Parts"
  | "Electronics"
  | "Plastics"
  | "Chemicals"
  | "Hardware"
  | "Office Supplies"
  | "Electrical"
  | "Safety Equipment"
  | "Textiles";

export const SUPPLIERS: SupplierRef[] = [
  // Deliberately similar names: "ABC" matches three suppliers, "Ganesh" matches two.
  { name: "ABC Traders Pvt Ltd", city: "Mumbai", country: "India", category: "General Trading", weight: 3, lateRate: 0.2 },
  { name: "ABC Metals", city: "Pune", country: "India", category: "Metals", weight: 2, lateRate: 0.25 },
  { name: "ABC Packaging", city: "Ahmedabad", country: "India", category: "Packaging", weight: 2, lateRate: 0.15 },
  { name: "Shree Ganesh Steel", city: "Ludhiana", country: "India", category: "Metals", weight: 3, lateRate: 0.5 },
  { name: "Ganesh Industries", city: "Rajkot", country: "India", category: "Machinery Parts", weight: 2, lateRate: 0.2 },
  { name: "Northwind Components", city: "Chicago", country: "USA", category: "Electronics", weight: 2, lateRate: 0.1 },
  { name: "Bluewater Logistics Supplies", city: "Rotterdam", country: "Netherlands", category: "Packaging", weight: 1, lateRate: 0.15 },
  { name: "Sahyadri Polymers", city: "Nashik", country: "India", category: "Plastics", weight: 2, lateRate: 0.2 },
  { name: "Coastal Chemicals Ltd", city: "Chennai", country: "India", category: "Chemicals", weight: 1, lateRate: 0.2 },
  { name: "Precision Fasteners Co", city: "Coimbatore", country: "India", category: "Hardware", weight: 2, lateRate: 0.1 },
  { name: "Evergreen Office Supplies", city: "Bengaluru", country: "India", category: "Office Supplies", weight: 1, lateRate: 0.05 },
  { name: "Delta Electricals", city: "Kolkata", country: "India", category: "Electrical", weight: 2, lateRate: 0.25 },
  { name: "Summit Safety Gear", city: "Austin", country: "USA", category: "Safety Equipment", weight: 1, lateRate: 0.1 },
  { name: "Orion Bearings", city: "Stuttgart", country: "Germany", category: "Machinery Parts", weight: 1, lateRate: 0.05 },
  { name: "Kaveri Textiles", city: "Tiruppur", country: "India", category: "Textiles", weight: 1, lateRate: 0.2 },
  { name: "Pacific Rim Electronics", city: "Shenzhen", country: "China", category: "Electronics", weight: 3, lateRate: 0.65 },
  { name: "Unity Hydraulics", city: "Faridabad", country: "India", category: "Machinery Parts", weight: 1, lateRate: 0.2 },
  { name: "Greenleaf Paper Mills", city: "Vapi", country: "India", category: "Packaging", weight: 1, lateRate: 0.15 },
  { name: "Atlas Tools & Hardware", city: "Hyderabad", country: "India", category: "Hardware", weight: 1, lateRate: 0.15 },
  { name: "Metro Lubricants", city: "Vadodara", country: "India", category: "Chemicals", weight: 1, lateRate: 0.2 },
];

export interface CatalogItem {
  name: string;
  sku: string;
  /** Unit price range in cents. */
  minCents: number;
  maxCents: number;
}

// Each category has at least 5 items so an order can pick 1-5 distinct ones.
export const CATALOG: Record<Category, CatalogItem[]> = {
  "General Trading": [
    { name: "Corrugated Boxes (Large)", sku: "GT-BOX-L", minCents: 120, maxCents: 350 },
    { name: "Cotton Waste Rags", sku: "GT-RAG", minCents: 80, maxCents: 200 },
    { name: "Nylon Rope 10mm", sku: "GT-ROPE-10", minCents: 300, maxCents: 900 },
    { name: "Tarpaulin Sheet 6x4m", sku: "GT-TARP", minCents: 1500, maxCents: 4000 },
    { name: "Industrial Cleaning Liquid 5L", sku: "GT-CLN-5", minCents: 900, maxCents: 2200 },
  ],
  Metals: [
    { name: "MS Plate 6mm", sku: "MT-MSP-6", minCents: 4500, maxCents: 9000 },
    { name: "SS 304 Sheet 2mm", sku: "MT-SS304-2", minCents: 6000, maxCents: 14000 },
    { name: "TMT Bar 12mm", sku: "MT-TMT-12", minCents: 1200, maxCents: 2600 },
    { name: "Aluminium Rod 20mm", sku: "MT-AL-20", minCents: 1800, maxCents: 4200 },
    { name: "GI Pipe 1 inch", sku: "MT-GI-1", minCents: 1500, maxCents: 3500 },
    { name: "Copper Wire 2.5mm", sku: "MT-CU-25", minCents: 2500, maxCents: 6000 },
  ],
  Packaging: [
    { name: "Stretch Film Roll", sku: "PK-STR", minCents: 800, maxCents: 1800 },
    { name: "BOPP Tape 48mm", sku: "PK-TAPE-48", minCents: 90, maxCents: 250 },
    { name: "Bubble Wrap Roll", sku: "PK-BUB", minCents: 1200, maxCents: 3000 },
    { name: "Wooden Pallet", sku: "PK-PAL", minCents: 1800, maxCents: 4500 },
    { name: "Kraft Paper Roll", sku: "PK-KRA", minCents: 2000, maxCents: 5000 },
  ],
  "Machinery Parts": [
    { name: "Ball Bearing 6205", sku: "MP-BB-6205", minCents: 250, maxCents: 900 },
    { name: "V-Belt B52", sku: "MP-VB-B52", minCents: 400, maxCents: 1100 },
    { name: "Hydraulic Seal Kit", sku: "MP-HSK", minCents: 1500, maxCents: 4500 },
    { name: "Gear Coupling", sku: "MP-GC", minCents: 3500, maxCents: 9000 },
    { name: "Hydraulic Pump 10cc", sku: "MP-HP-10", minCents: 15000, maxCents: 40000 },
    { name: "Drive Shaft Assembly", sku: "MP-DSA", minCents: 12000, maxCents: 30000 },
  ],
  Electronics: [
    { name: "PLC Module", sku: "EL-PLC", minCents: 20000, maxCents: 60000 },
    { name: "Proximity Sensor", sku: "EL-PRX", minCents: 1500, maxCents: 4500 },
    { name: "HMI Touch Panel 7in", sku: "EL-HMI-7", minCents: 25000, maxCents: 70000 },
    { name: "Power Supply 24V", sku: "EL-PSU-24", minCents: 3000, maxCents: 8000 },
    { name: "Relay Board 8ch", sku: "EL-RLY-8", minCents: 1200, maxCents: 3500 },
  ],
  Plastics: [
    { name: "HDPE Granules (25kg)", sku: "PL-HDPE", minCents: 2500, maxCents: 5000 },
    { name: "PVC Pipe 2 inch", sku: "PL-PVC-2", minCents: 400, maxCents: 1200 },
    { name: "PP Crate", sku: "PL-CRATE", minCents: 600, maxCents: 1500 },
    { name: "Polycarbonate Sheet", sku: "PL-PCS", minCents: 3000, maxCents: 8000 },
    { name: "Nylon Bush", sku: "PL-NBUSH", minCents: 50, maxCents: 300 },
  ],
  Chemicals: [
    { name: "Hydraulic Oil 68 (20L)", sku: "CH-HO68", minCents: 4000, maxCents: 9000 },
    { name: "Industrial Degreaser 20L", sku: "CH-DGR", minCents: 3000, maxCents: 7000 },
    { name: "Epoxy Primer 4L", sku: "CH-EPX", minCents: 2500, maxCents: 6000 },
    { name: "Coolant Concentrate 20L", sku: "CH-CLT", minCents: 3500, maxCents: 8000 },
    { name: "Grease EP2 (18kg)", sku: "CH-GRS", minCents: 4500, maxCents: 9500 },
  ],
  Hardware: [
    { name: "Hex Bolt M12 (box of 100)", sku: "HW-HB-M12", minCents: 1200, maxCents: 3000 },
    { name: "Anchor Fastener M10", sku: "HW-AF-M10", minCents: 40, maxCents: 150 },
    { name: "Spanner Set", sku: "HW-SPN", minCents: 2500, maxCents: 6000 },
    { name: "Drill Bit Set HSS", sku: "HW-DRL", minCents: 1800, maxCents: 4500 },
    { name: "Washer M12 (box of 200)", sku: "HW-WS-M12", minCents: 500, maxCents: 1400 },
  ],
  "Office Supplies": [
    { name: "A4 Paper Ream", sku: "OF-A4", minCents: 350, maxCents: 700 },
    { name: "Printer Toner", sku: "OF-TNR", minCents: 4000, maxCents: 9000 },
    { name: "File Folders (pack of 50)", sku: "OF-FLD", minCents: 600, maxCents: 1500 },
    { name: "Whiteboard Markers (box)", sku: "OF-MRK", minCents: 300, maxCents: 800 },
    { name: "Ergonomic Chair", sku: "OF-CHR", minCents: 9000, maxCents: 25000 },
  ],
  Electrical: [
    { name: "MCB 32A", sku: "EC-MCB-32", minCents: 300, maxCents: 900 },
    { name: "Armoured Cable 4 core (per m)", sku: "EC-ARM-4", minCents: 250, maxCents: 700 },
    { name: "LED High Bay 150W", sku: "EC-LED-150", minCents: 4000, maxCents: 9000 },
    { name: "Contactor 40A", sku: "EC-CTR-40", minCents: 1500, maxCents: 4000 },
    { name: "Distribution Board 12 way", sku: "EC-DB-12", minCents: 3000, maxCents: 7500 },
  ],
  "Safety Equipment": [
    { name: "Safety Helmet", sku: "SF-HLM", minCents: 300, maxCents: 900 },
    { name: "Safety Shoes", sku: "SF-SHO", minCents: 1500, maxCents: 4000 },
    { name: "Nitrile Gloves (box)", sku: "SF-GLV", minCents: 600, maxCents: 1500 },
    { name: "Safety Goggles", sku: "SF-GOG", minCents: 200, maxCents: 700 },
    { name: "Full Body Harness", sku: "SF-HRN", minCents: 3500, maxCents: 9000 },
  ],
  Textiles: [
    { name: "Cotton Fabric Roll", sku: "TX-COT", minCents: 3000, maxCents: 8000 },
    { name: "Polyester Thread Cone", sku: "TX-THR", minCents: 150, maxCents: 400 },
    { name: "Work Uniform Set", sku: "TX-UNI", minCents: 1200, maxCents: 3000 },
    { name: "Canvas Sheet", sku: "TX-CNV", minCents: 2000, maxCents: 5000 },
    { name: "Cotton Webbing Belt", sku: "TX-WEB", minCents: 100, maxCents: 350 },
  ],
};
