import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import firebaseConfig from "../firebase-applet-config.json" assert { type: "json" };

const config = {
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  appId: firebaseConfig.appId
};

const app = initializeApp(config);
const auth = getAuth(app);

const testEmails = [
  "shwayat.mustafa@gmail.com",
  "mustafa@pharmacrm.com",
  "admin@esnad.com",
  "gm@esand.com",
  "libyasmm.test@esand.com",
  "libyamk.test@esand.com",
  "finance@esand.com",
  "finance.ly@esnad.local",
  "ops.ly@esnad.local",
  "store.ly@esnad.local",
  "delivey@esnad.local",
  "orderops@esnad.com",
  "warehouse@esnad.com",
  "store@esnad.com",
  "finance.officer@esnad.com"
];

const testPasswords = [
  "123456",
  "12345678",
  "Esnad#2026",
  "MenaReps#2026",
  "Password123!",
  "password",
  "admin123"
];

async function run() {
  for (const email of testEmails) {
    let success = false;
    for (const password of testPasswords) {
      try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        console.log(`SUCCESS: ${email} -> password: "${password}" (UID: ${cred.user.uid})`);
        success = true;
        break;
      } catch (e: any) {
        // continue
      }
    }
    if (!success) {
      console.log(`FAILED: ${email}`);
    }
  }
}

run().catch(console.error);
