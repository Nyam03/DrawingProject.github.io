import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, onSnapshot, query, orderBy, 
  deleteDoc, doc, updateDoc, setDoc, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

// 전역 상태
const roomId = "room1";
let currentPageId = "page1";
let currentLayerId = "layer1";
let tool = "brush", color = "#000000", size = 5;
let scale = 1, offset = { x: 0, y: 0 };
let drawing = false, currentStroke = [];

let layers = []; 
let canvases = {}, contexts = {};
let unsubscribes = []; // 페이지 전환 시 모든 리스너 해제용

// 1. 초기 실행 및 페이지 감시
async function init() {
  const pagesRef = collection(db, "rooms", roomId, "pages");
  const q = query(pagesRef, orderBy("order", "asc"));

  onSnapshot(q, (snap) => {
    const pageTabs = document.getElementById("pageTabs");
    pageTabs.innerHTML = "";
    
    if (snap.empty) {
      // 페이지가 하나도 없으면 기본 페이지 생성
      setupFirstPage();
      return;
    }

    snap.forEach(docSnap => {
      const pId = docSnap.id;
      const tab = document.createElement("div");
      tab.className = `page-tab ${pId === currentPageId ? "active" : ""}`;
      tab.innerHTML = `<span>${pId}</span> <button class="del-page-btn">✕</button>`;
      
      tab.onclick = () => switchPage(pId);
      tab.querySelector(".del-page-btn").onclick = (e) => {
        e.stopPropagation();
        deletePage(pId);
      };
      
      pageTabs.appendChild(tab);
    });
  });

  // 첫 진입 시 수동 호출
  switchPage(currentPageId);
}

// 2. 페이지 전환 함수 (가장 중요)
async function switchPage(pId) {
  currentPageId = pId;
  
  // 기존 리스너 해제
  unsubscribes.forEach(unsub => unsub());
  unsubscribes = [];

  // UI 초기화
  const container = document.getElementById("canvasContainer");
  container.innerHTML = "";
  canvases = {}; contexts = {}; layers = [];
  document.getElementById("layersList").innerHTML = "";

  // 페이지 배경색 적용
  const pageRef = doc(db, "rooms", roomId, "pages", pId);
  const pageSnap = onSnapshot(pageRef, (d) => {
    if (d.exists()) {
      container.style.backgroundColor = d.data().bgColor || "#ffffff";
    }
  });
  unsubscribes.push(pageSnap);

  // 해당 페이지의 레이어들 불러오기
  const layersRef = collection(db, "rooms", roomId, "pages", pId, "layers");
  const layerSnap = await getDocs(layersRef);

  if (layerSnap.empty) {
    // 레이어가 없으면 기본 레이어1 생성
    await createLayer("layer1");
  } else {
    layerSnap.forEach(lDoc => {
      renderLayerCanvas(lDoc.id);
      listenStrokes(lDoc.id);
    });
  }
}

// 3. 레이어 생성 및 DOM 반영
async function createLayer(lId) {
  const layerRef = doc(db, "rooms", roomId, "pages", currentPageId, "layers", lId);
  await setDoc(layerRef, { order: layers.length, opacity: 1 });
  
  renderLayerCanvas(lId);
  listenStrokes(lId);
}

function renderLayerCanvas(lId) {
  const container = document.getElementById("canvasContainer");
  const canvas = document.createElement("canvas");
  canvas.width = 1920; canvas.height = 1080;
  canvas.id = `canvas-${lId}`;
  canvas.className = "layerCanvas";
  container.appendChild(canvas);

  canvases[lId] = canvas;
  contexts[lId] = canvas.getContext("2d", { willReadFrequently: true });
  currentLayerId = lId;

  // 레이어 패널 UI 업데이트
  updateLayerUI(lId);
}

// 4. 스트로크 실시간 동기화
function listenStrokes(lId) {
  const strokesRef = collection(db, "rooms", roomId, "pages", currentPageId, "layers", lId, "strokes");
  const q = query(strokesRef, orderBy("timestamp", "asc"));

  const unsub = onSnapshot(q, (snap) => {
    const ctx = contexts[lId];
    if (!ctx) return;
    ctx.clearRect(0, 0, 1920, 1080);
    
    snap.forEach(d => {
      const data = d.data();
      drawStroke(ctx, data);
    });
  });
  unsubscribes.push(unsub);
}

// 5. 드로잉 이벤트
document.getElementById("canvasContainer").onmousedown = (e) => {
  drawing = true;
  currentStroke = [];
};

document.onmousemove = (e) => {
  if (!drawing) return;
  const pos = getMousePos(e);
  currentStroke.push(pos);
  
  // 실시간 피드백 (내 화면에만 미리 그리기)
  const ctx = contexts[currentLayerId];
  if (ctx) {
    ctx.lineWidth = size;
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }
};

document.onmouseup = async () => {
  if (!drawing) return;
  drawing = false;
  
  if (currentStroke.length < 2) return;

  const strokesRef = collection(db, "rooms", roomId, "pages", currentPageId, "layers", currentLayerId, "strokes");
  await addDoc(strokesRef, {
    points: currentStroke,
    color,
    size,
    tool,
    timestamp: Date.now()
  });
};

// 헬퍼 함수: 마우스 좌표 계산
function getMousePos(e) {
  const rect = document.getElementById("canvasWrapper").getBoundingClientRect();
  return {
    x: (e.clientX - rect.left - offset.x) / scale,
    y: (e.clientY - rect.top - offset.y) / scale
  };
}

function drawStroke(ctx, data) {
  ctx.beginPath();
  ctx.lineWidth = data.size;
  ctx.strokeStyle = data.color;
  ctx.globalCompositeOperation = data.tool === "eraser" ? "destination-out" : "source-over";
  ctx.lineCap = ctx.lineJoin = "round";
  
  data.points.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();
}

function updateLayerUI(lId) {
  const list = document.getElementById("layersList");
  const div = document.createElement("div");
  div.className = `layer-item ${lId === currentLayerId ? "active" : ""}`;
  div.innerHTML = `<span>${lId}</span>`;
  div.onclick = () => { currentLayerId = lId; };
  list.appendChild(div);
}

// 초기화 호출
init();