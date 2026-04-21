import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, doc, setDoc, onSnapshot, query, where, deleteDoc, getDocs, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { 
  getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// --- 1. Firebase 설정 ---
const firebaseConfig = {
  apiKey: "AIzaSyAje85hdqJ9iEZuvL57ZYL2HJa8vUZcGBc",
  authDomain: "drawingproject-ae35d.firebaseapp.com",
  projectId: "drawingproject-ae35d",
  storageBucket: "drawingproject-ae35d.firebasestorage.app",
  messagingSenderId: "224466239154",
  appId: "1:224466239154:web:951dd5a55526c8edfa53ab"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// --- 2. 상태 변수 ---
let currentUser = null;
const roomId = "room1";
let tool = "brush", color = "#000000", size = 5;
let layers = [];
let canvases = {}, contexts = {};

// --- 3. 로그인 및 접속자 관리 (핵심 기능) ---
const loginOverlay = document.getElementById("loginOverlay");
const appUI = document.getElementById("app");
const userListEl = document.getElementById("userList");

// 구글 로그인
document.getElementById("googleLoginBtn").onclick = () => signInWithPopup(auth, provider);

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    loginOverlay.style.display = "none";
    appUI.style.display = "flex"; // 로그인 후 화면 보이기

    // 온라인 상태 등록
    await setDoc(doc(db, "rooms", roomId, "users", user.uid), {
      name: user.displayName,
      photo: user.photoURL,
      lastSeen: serverTimestamp()
    });

    // 접속자 목록 실시간 모니터링
    observeUsers();
    // 캔버스 초기화
    if (layers.length === 0) createLayer("layer1");
  } else {
    loginOverlay.style.display = "flex";
    appUI.style.display = "none";
  }
});

function observeUsers() {
  onSnapshot(collection(db, "rooms", roomId, "users"), (snap) => {
    userListEl.innerHTML = "";
    snap.forEach(docSnap => {
      const userData = docSnap.data();
      const chip = document.createElement("div");
      chip.className = "user-chip";
      chip.title = userData.name;
      chip.innerHTML = `<img src="${userData.photo || 'https://via.placeholder.com/32'}" alt="${userData.name}">`;
      userListEl.appendChild(chip);
    });
  });
}

// --- 4. 레이어 및 드로잉 로직 (기본 롤백 코드 기반) ---
function createLayer(id) {
  const container = document.getElementById("canvasContainer");
  const canvas = document.createElement("canvas");
  canvas.width = 1920; canvas.height = 1080;
  canvas.className = "layerCanvas";
  canvas.id = id;
  container.appendChild(canvas);

  canvases[id] = canvas;
  contexts[id] = canvas.getContext("2d");
  
  // 드로잉 이벤트 연결 (생략 가능하나 기능 유지를 위해 포함)
  setupDrawingEvents(canvas, id);
}

function setupDrawingEvents(canvas, layerId) {
  let drawing = false;
  const ctx = contexts[layerId];

  const start = (e) => { drawing = true; ctx.beginPath(); };
  const move = (e) => {
    if (!drawing) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    
    ctx.lineWidth = size;
    ctx.lineCap = "round";
    ctx.strokeStyle = tool === "eraser" ? "#ffffff" : color;
    
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const end = () => { drawing = false; };

  canvas.onmousedown = start;
  window.onmousemove = move;
  window.onmouseup = end;
}

// --- 5. 기타 UI 이벤트 ---
document.getElementById("brush").onclick = () => { tool = "brush"; updateActiveTool("brush"); };
document.getElementById("eraser").onclick = () => { tool = "eraser"; updateActiveTool("eraser"); };
document.getElementById("color").oninput = (e) => color = e.target.value;
const sizeIn = document.getElementById("size");
const sizeSl = document.getElementById("sizeRange");
sizeIn.oninput = (e) => { size = e.target.value; sizeSl.value = size; };
sizeSl.oninput = (e) => { size = e.target.value; sizeIn.value = size; };

function updateActiveTool(id) {
  document.querySelectorAll(".tool-btn").forEach(btn => btn.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

document.getElementById("reset-btn").onclick = async () => {
  if (!confirm("정말로 캔버스를 리셋할까요?")) return;
  Object.values(contexts).forEach(ctx => ctx.clearRect(0, 0, 1920, 1080));
};

document.getElementById("export").onclick = () => {
  const link = document.createElement("a");
  link.download = "drawing.png";
  link.href = canvases["layer1"].toDataURL();
  link.click();
};