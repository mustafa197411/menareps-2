const fetch = globalThis.fetch;

async function runSecurityTests() {
  console.log("==================================================================");
  console.log("MENAREPS 2.0 - /api/ai PERIMETER SECURITY INTEGRITY TEST RUNNER");
  console.log("==================================================================");
  const baseUrl = "http://localhost:3000/api/ai";

  const testCases = [
    {
      id: "AI-AUTH-01",
      description: "Anonymous request with no authorization header",
      headers: {
        "Content-Type": "application/json"
      },
      body: { action: "dashboard", payload: { region: "Libya" } }
    },
    {
      id: "AI-AUTH-02",
      description: "Request with blank/empty Authorization header",
      headers: {
        "Content-Type": "application/json",
        "Authorization": ""
      },
      body: { action: "dashboard", payload: { region: "Libya" } }
    },
    {
      id: "AI-AUTH-03",
      description: "Request with malformed Authorization header (missing Bearer prefix)",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "JustJunkToken123456"
      },
      body: { action: "dashboard", payload: { region: "Libya" } }
    },
    {
      id: "AI-AUTH-04",
      description: "Request with invalid JWT / signature-invalid token",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMyJ9.eyJ1aWQiOiJyZXAtMTIzIn0.invalid_signature"
      },
      body: { action: "dashboard", payload: { region: "Libya" } }
    },
    {
      id: "AI-AUTH-12",
      description: "Forge Header Attempt (passing Super Admin x-user headers but no valid token)",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "USR-SUPERADMIN-999",
        "x-user-role": "Super Admin",
        "x-user-country": "Jordan",
        "x-user-countries": '["Libya","Jordan","Iraq","Saudi Arabia"]'
      },
      body: { action: "dashboard", payload: { region: "Libya" } }
    },
    {
      id: "AI-AUTH-12b",
      description: "Forge Header Attempt with invalid token signatures",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "USR-SUPERADMIN-999",
        "x-user-role": "Super Admin",
        "Authorization": "Bearer invalid_forged_token"
      },
      body: { action: "dashboard", payload: { region: "Libya" } }
    }
  ];

  for (const tc of testCases) {
    console.log(`\n[TEST] Executing ${tc.id}: ${tc.description}...`);
    try {
      const response = await fetch(baseUrl, {
        method: "POST",
        headers: tc.headers as any,
        body: JSON.stringify(tc.body)
      });
      
      const status = response.status;
      const data: any = await response.json();
      
      console.log(`[RESULT] HTTP Status: ${status}`);
      console.log(`[RESPONSE] ${JSON.stringify(data)}`);
      
      const passed = status === 401 || status === 403;
      console.log(`[STATUS] ${passed ? "PASS (Security Enforced)" : "FAIL (Vulnerable)"}`);
    } catch (err: any) {
      console.error(`[ERROR] ${tc.id} failed with exception:`, err.message || err);
    }
  }
  console.log("\n==================================================================");
  console.log("PERIMETER SECURITY SUITE COMPLETE");
  console.log("==================================================================");
}

runSecurityTests();
