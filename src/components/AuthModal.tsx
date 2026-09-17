import React, { useState } from "react";
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut 
} from "firebase/auth";
import { doc, setDoc, getDoc, getDocs, query, where, collection, deleteDoc, writeBatch } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { Role, User } from "../types";
import { X, Mail, Lock, User as UserIcon, Shield, Loader2, LogOut } from "lucide-react";
import { decorateRecord } from "../lib/firebaseSync";
import { claimActivationViaBackend } from "../lib/authApiClient";
import { removeUndefinedRecursively } from "../utils/importNormalization";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: "en" | "ar";
  onAuthSuccess: (profile: User) => void;
  currentRealUser: any;
}

export default function AuthModal({
  isOpen,
  onClose,
  lang,
  onAuthSuccess,
  currentRealUser
}: AuthModalProps) {
  const isRtl = lang === "ar";
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [selectedRole, setSelectedRole] = useState<Role>(Role.SUPER_ADMIN);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!isOpen) return null;

  const t = {
    en: {
      titleSignIn: "Secure Cloud Login",
      titleSignUp: "Register Cloud Account",
      descSignIn: "Access MENAREPS CRM cloud-synchronized database using your personal enterprise credentials.",
      descSignUp: "Create a new synchronized operator profile linked to Firebase Authentication.",
      email: "Email Address",
      password: "Password",
      fullName: "Full Name",
      role: "Select Functional Role",
      signInBtn: "Secure Login",
      signUpBtn: "Register & Initialize",
      switchSignUp: "New operator? Register a cloud profile",
      switchSignIn: "Already have an account? Sign in here",
      logout: "Log Out of Session",
      loggedInAs: "Logged in via Cloud Auth as:"
    },
    ar: {
      titleSignIn: "تسجيل الدخول السحابي الآمن",
      titleSignUp: "تسجيل حساب سحابي جديد",
      descSignIn: "الوصول إلى قاعدة بيانات مينا ريبس CRM المزامنة سحابياً باستخدام بيانات الاعتماد الخاصة بك.",
      descSignUp: "إنشاء ملف تعريف مشغل متزامن جديد مرتبط بـ Firebase Authentication.",
      email: "البريد الإلكتروني",
      password: "كلمة المرور",
      fullName: "الاسم الكامل",
      role: "حدد الدور الوظيفي",
      signInBtn: "تسجيل الدخول الآمن",
      signUpBtn: "تسجيل وتهيئة الحساب",
      switchSignUp: "مشغل جديد؟ سجل ملفاً سحابياً",
      switchSignIn: "لديك حساب بالفعل؟ سجل دخولك هنا",
      logout: "تسجيل الخروج من الجلسة",
      loggedInAs: "مسجل الدخول سحابياً باسم:"
    }
  }[lang];

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (isSignUp) {
        // 1. Create firebase auth user first, so they are logged in and satisfy security rules for email query
        const normalizedEmail = email.trim().toLowerCase();
        let credential;
        try {
          console.info("[Auth] Attempting createUserWithEmailAndPassword", {
            operation: "createUserWithEmailAndPassword",
            email: normalizedEmail
          });
          credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
          console.info("[Auth] Successfully created Auth user", { uid: credential.user.uid });
        } catch (authErr: any) {
          console.error("[Auth Error] Failed to create authenticated user", {
            operation: "createUserWithEmailAndPassword",
            email: normalizedEmail,
            code: authErr.code,
            message: authErr.message
          });
          throw authErr;
        }

        const fbUser = credential.user;
        const idToken = await fbUser.getIdToken();

        console.info("[Auth Registration] Requesting trusted backend claim-activation for UID:", fbUser.uid);
        const claimResult = await claimActivationViaBackend(idToken);

        if (!claimResult.success || !claimResult.user) {
          console.error("[Auth Registration Error] Backend activation claim failed:", claimResult);
          try {
            await fbUser.delete();
          } catch (delErr) {
            console.warn("[Auth Clean-Up] Failed to delete Auth user on claim error:", delErr);
          }
          const userMsg = claimResult.error || "Activation claim failed.";
          throw new Error(isRtl ? `فشل التسجيل: ${userMsg}` : userMsg);
        }

        console.info("[Auth Registration] Successfully claimed activation profile via backend for UID:", fbUser.uid);
        onAuthSuccess(claimResult.user as User);
      } else {
        // 1. Sign in
        await signInWithEmailAndPassword(auth, email, password);
      }
      onClose();
    } catch (err: any) {
      console.error("Auth error:", err);
      const isOperationNotAllowed = err.code === "auth/operation-not-allowed" || (err.message && err.message.includes("operation-not-allowed"));
      const isInvalidCredential = err.code === "auth/invalid-credential" || err.code === "auth/user-not-found" || err.code === "auth/wrong-password" || (err.message && err.message.includes("invalid-credential"));
      if (isOperationNotAllowed) {
        if (isRtl) {
          setError("خطأ في المصادقة: لم يتم تفعيل تسجيل الدخول بالبريد الإلكتروني وكلمة المرور في مشروع Firebase الخاص بك. لتفعيله: اذهب إلى لوحة تحكم Firebase Console -> Authentication -> Sign-in method -> ثم قم بتفعيل Email/Password.");
        } else {
          setError("Auth Error: Email/Password sign-in provider is not enabled in your Firebase Console. To enable: Go to Firebase Console -> Build -> Authentication -> Sign-in method, then enable Email/Password.");
        }
      } else if (isInvalidCredential) {
        if (isRtl) {
          setError("فشلت عملية المصادقة. إذا كان هذا أول تسجيل دخول لك بعد قيام الإدارة بإنشاء حسابك، يرجى استخدام تبويب 'إنشاء حساب' (Sign Up) بالخلف لتفعيل حسابك وتعيين كلمة المرور الخاصة بك.");
        } else {
          setError("Authentication failed. If this is your first login after being registered by an Admin, please click the 'Sign Up' tab above to activate your pre-created account and set your password.");
        }
      } else {
        setError(err.message || "Authentication failed. Please verify credentials.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await signOut(auth);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" id="auth-modal-overlay">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs transition-opacity cursor-pointer"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-150 dark:border-slate-800 overflow-hidden z-10 animate-fade-in text-xs font-sans p-6 text-slate-800 dark:text-slate-200">
        
        {/* Header */}
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="font-extrabold text-slate-950 dark:text-white text-sm tracking-tight flex items-center gap-1.5 uppercase">
              <Shield size={16} className="text-blue-600 dark:text-blue-400 shrink-0" />
              <span>{isSignUp ? t.titleSignUp : t.titleSignIn}</span>
            </h3>
            <p className="text-xxs text-slate-400 mt-1 leading-relaxed">
              {isSignUp ? t.descSignUp : t.descSignIn}
            </p>
          </div>
          <button 
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-slate-150 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer shrink-0"
          >
            <X size={14} />
          </button>
        </div>

        {error && (
          <div className="p-3 mb-4 bg-rose-50/50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 text-rose-600 rounded-lg text-xxs font-semibold">
            {error}
          </div>
        )}

        {currentRealUser ? (
          /* Logged In Status / Sign out flow */
          <div className="space-y-4 py-3 text-center">
            <div className="p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 rounded-xl">
              <span className="text-xxs text-slate-400 font-mono block uppercase">{t.loggedInAs}</span>
              <span className="font-extrabold text-slate-950 dark:text-white text-xs mt-1 block">{currentRealUser.email}</span>
            </div>
            
            <button
              onClick={handleLogout}
              disabled={loading}
              className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
              <span>{t.logout}</span>
            </button>
          </div>
        ) : (
          /* Form inputs for Login/Register */
          <form onSubmit={handleAuth} className="space-y-4">
            {isSignUp && (
              <div className="space-y-1">
                <label className="font-bold text-slate-500 uppercase block tracking-wider text-[10px]">{t.fullName}</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <UserIcon size={14} />
                  </span>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Wajdi Al-Hassan"
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg outline-none text-slate-800 dark:text-white focus:border-blue-500 focus:bg-white font-medium"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1">
              <label className="font-bold text-slate-500 uppercase block tracking-wider text-[10px]">{t.email}</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <Mail size={14} />
                </span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg outline-none text-slate-800 dark:text-white focus:border-blue-500 focus:bg-white font-mono"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="font-bold text-slate-500 uppercase block tracking-wider text-[10px]">{t.password}</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <Lock size={14} />
                </span>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg outline-none text-slate-800 dark:text-white focus:border-blue-500 focus:bg-white font-mono"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : null}
              <span>{isSignUp ? t.signUpBtn : t.signInBtn}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsSignUp(!isSignUp)}
              className="w-full text-center text-[10px] text-blue-600 dark:text-blue-400 font-bold hover:underline cursor-pointer"
            >
              {isSignUp ? t.switchSignIn : t.switchSignUp}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
