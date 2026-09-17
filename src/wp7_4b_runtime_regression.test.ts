import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("WP7.4B - Runtime Initialization Regression Verification", () => {
  const salesOrdersPath = path.join(process.cwd(), "src/components/sales/SalesOrders.tsx");
  const salesOrdersContent = fs.readFileSync(salesOrdersPath, "utf-8");

  it("ensures selectedOrderDetail is declared before any hooks or effects reference it (TDZ Fix)", () => {
    const lines = salesOrdersContent.split("\n");

    let declarationLine = -1;
    let firstAccessLine = -1;

    lines.forEach((line, index) => {
      const lineNum = index + 1;
      if (line.includes("const [selectedOrderDetail, setSelectedOrderDetail] = useState")) {
        if (declarationLine === -1) {
          declarationLine = lineNum;
        }
      }
      if (line.includes("selectedOrderDetail?.") || line.includes("selectedOrderDetail.")) {
        if (firstAccessLine === -1 && !line.includes("const [selectedOrderDetail")) {
          firstAccessLine = lineNum;
        }
      }
    });

    expect(declarationLine).toBeGreaterThan(0);
    expect(firstAccessLine).toBeGreaterThan(0);
    expect(declarationLine).toBeLessThan(firstAccessLine);
  });

  it("verifies physician reads use the backend scoped controller in App.tsx", () => {
    const appPath = path.join(process.cwd(), "src/App.tsx");
    const appContent = fs.readFileSync(appPath, "utf-8");

    expect(appContent).toContain("createPhysicianReadController");
    expect(appContent).not.toContain('onSnapshot(collection(db, "physicians")');
  });

  it("verifies order details state decoupling remains intact across workflow actions", () => {
    expect(salesOrdersContent).toContain("setSelectedOrderDetail(refreshedOrder)");
    expect(salesOrdersContent).toContain("setSelectedOrderId(orderId)");
    expect(salesOrdersContent).toContain("setViewMode(\"details\")");
  });
});
