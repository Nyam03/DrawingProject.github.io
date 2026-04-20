import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, onSnapshot, query, orderBy, 
  deleteDoc, doc, updateDoc, setDoc, getDocs, writeBatch
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

// 상태 관리
const roomId = "room1";
let currentPageId = "page1";
let pages = ["page1"];
let currentLayer = "layer1";
let tool = "brush", color = "#000000", size = 5;
let layers = []; 
let canvases = {}, contexts = {};
let scale = 1, offset = { x: 0, y: 0 };
let unsubscribeList = []; // 페이지 전환 시 리스너 해제용

// 📄 페이지 관리 기능
async function initPages() {
  const pagesRef = collection(db, "rooms", roomId, "pages");
  onSnapshot(pagesRef, (snap) => {
    pages = snap.empty ? ["page1"] : snap.docs.map(d => d.id).sort();
    updatePageUI();
  });
}

function updatePageUI() {
  const container = document.getElementById("pageTabs");
  container.innerHTML = "";
  pages.forEach((pId, idx) => {
    const tab = document.createElement("div");
    tab.className = `page-tab ${currentPageId === pId ? "active" : ""}`;
    tab.innerHTML = `<span>${idx + 1}번 장</span> <span class="del-page">✕</span>`;
    tab.onclick = () => switchPage(pId);
    tab.querySelector(".del-page").onclick = (e) => { e.stopPropagation(); deletePage(pId); };
    container.appendChild(tab);
  });
}

async function switchPage(pId) {
  if (currentPageId === pId) return;
  currentPageId = pId;
  
  // 기존 리스너 해제 및 캔버스 초기화
  unsubscribeList.forEach(unsub => unsub());
  unsubscribeList = [];
  document.getElementById("canvasContainer").innerHTML = "";
  canvases = {}; contexts = {}; layers = [];
  
  // 해당 페이지의 배경색 동기화
  const pageDoc = await doc(db, "rooms", roomId, "pages", pId);
  onSnapshot(pageDoc, (docSnap) => {
    if (docSnap.exists()) {
      document.getElementById("canvasContainer").style.backgroundColor = docSnap.data().bgColor || "#ffffff";
    }
  });

  createLayer("layer1");
  updatePageUI();
}

async function deletePage(pId) {
  if (pages.length <= 1) return alert("최소 한 장의 페이지는 필요합니다.");
  if (!confirm("해당 페이지의 모든 데이터가 삭제됩니다. 계속하시겠습니까?")) return;

  const pageRef = doc(db, "rooms", roomId, "pages", pId);
  await deleteDoc(pageRef); // 실제 구현 시 하위 컬렉션(strokes)도 재귀적으로 삭제하는 로직이 필요함
  if (currentPageId === pId) switchPage(pages[0] === pId ? pages[1] : pages[0]);
}

// 🧱 레이어 및 드로잉 로직 (최적화 포함)
function createLayer(layerId) {
  const container = document.getElementById("canvasContainer");
  const canvas = document.createElement("canvas");
  canvas.width = 1920; canvas.height = 1080;
  canvas.classList.add("layerCanvas");
  canvas.id = `canvas-${layerId}`;
  container.appendChild(canvas);

  canvases[layerId] = canvas;
  contexts[layerId] = canvas.getContext("2d", { willReadFrequently: true });

  const newLayer = { id: layerId, order: layers.length, opacity: 1 };
  layers.push(newLayer);
  
  listenLayer(layerId);
  updateLayerUI();
}

// 🚀 최적화: 거리 기반 포인트 필터링 (RDP 간소화 버전)
function simplifyPoints(points, tolerance = 2) {
  if (points.length <= 2) return points;
  const result = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const last = result[result.length - 1];
    const dist = Math.sqrt(Math.pow(points[i].x - last.x, 2) + Math.pow(points[i].y - last.y, 2));
    if (dist > tolerance) result.push(points[i]);
  }
  result.push(points[points.length - 1]);
  return result;
}

// ✍️ 드로잉 이벤트
document.addEventListener("mousedown", (e) => {
  if (e.target.closest("#canvasContainer")) {
    if (tool === "bucket") {
      const pos = getMousePos(e);
      handleFloodFill(pos);
    } else {
      drawing = true;
      currentStroke = [];
    }
  }
});

document.addEventListener("mouseup", async () => {
  if (!drawing) return;
  drawing = false;
  if (currentStroke.length === 0) return;

  // 데이터 최적화 후 업로드
  const optimizedPoints = simplifyPoints(currentStroke);
  const ref = collection(db, "rooms", roomId, "pages", currentPageId, "layers", currentLayer, "strokes");
  await addDoc(ref, {
    points: optimizedPoints, color, size, tool, timestamp: Date.now()
  });
});

// 🪣 페인트통 (Flood Fill) 기능
function handleFloodFill(pos) {
  const ctx = contexts[currentLayer];
  const imageData = ctx.getImageData(0, 0, 1920, 1080);
  // 웹 워커나 라이브러리 없이 구현 시 성능 저하가 있을 수 있어, 
  // 여기서는 위치 정보와 색상만 Firestore에 기록하고 리스너에서 채우기를 실행하도록 설계하는 것이 동기화에 유리합니다.
  const ref = collection(db, "rooms", roomId, "pages", currentPageId, "layers", currentLayer, "strokes");
  addDoc(ref, {
    type: "fill", startPos: pos, color, timestamp: Date.now()
  });
}

// 📡 동기화 리스너
function listenLayer(layerId) {
  const ref = collection(db, "rooms", roomId, "pages", currentPageId, "layers", layerId, "strokes");
  const q = query(ref, orderBy("timestamp"));
  const unsub = onSnapshot(q, (snap) => {
    const ctx = contexts[layerId];
    ctx.clearRect(0, 0, 1920, 1080);
    snap.forEach(doc => {
      const s = doc.data();
      if (s.type === "fill") {
        renderFloodFill(ctx, s.startPos, s.color);
      } else {
        renderStroke(ctx, s);
      }
    });
  });
  unsubscribeList.push(unsub);
}

function renderStroke(ctx, s) {
  ctx.lineWidth = s.size;
  ctx.strokeStyle = s.color;
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.globalCompositeOperation = s.tool === "eraser" ? "destination-out" : "source-over";
  ctx.beginPath();
  s.points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.stroke();
}

// 단순화된 채우기 로직 (실제 서비스 시에는 스캔라인 알고리즘 권장)
function renderFloodFill(ctx, pos, fillColor) {
  ctx.fillStyle = fillColor;
  ctx.globalCompositeOperation = "source-over";
  // 참고: 캔버스 전체를 채우는 방식이나 특정 영역 채우기 로직 구현
  // 레이어 기반 시스템에서는 해당 레이어의 빈 공간을 채우는 용도로 사용
  ctx.fillRect(0,0, 1920, 1080); // 예시: 레이어 전체 채우기
}

// 초기 실행
initPages();
switchPage("page1");

// 이벤트 바인딩
document.getElementById("addPage").onclick = async () => {
  if (pages.length >= 3) return alert("최대 3장까지만 추가 가능합니다.");
  const newId = `page${Date.now()}`;
  await setDoc(doc(db, "rooms", roomId, "pages", newId), { 
    bgColor: "#ffffff", 
    createdAt: Date.now() 
  });
  switchPage(newId);
};

document.getElementById("bgColor").oninput = (e) => {
  const newColor = e.target.value;
  updateDoc(doc(db, "rooms", roomId, "pages", currentPageId), { bgColor: newColor });
};

document.getElementById("bucket").onclick = (e) => { tool = "bucket"; setActiveTool(e.target); };
document.getElementById("lasso").onclick = (e) => { tool = "lasso"; setActiveTool(e.target); };
document.getElementById("addLayer").onclick = () => createLayer(`layer${layers.length + 1}`);
document.getElementById("brush").onclick = (e) => { tool = "brush"; setActiveTool(e.target); };
document.getElementById("eraser").onclick = (e) => { tool = "eraser"; setActiveTool(e.target); };
document.getElementById("color").oninput = (e) => color = e.target.value;
document.getElementById("size").oninput = (e) => {
  let val = parseInt(e.target.value);
  if (isNaN(val) || val < 1) val = 1;
  if (val > 100) val = 100;
  size = val;
};

function setActiveTool(btn) {
  document.querySelectorAll(".tool-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
}

document.getElementById("export").onclick = () => {
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = 1920; exportCanvas.height = 1080;
  const ctx = exportCanvas.getContext("2d");
  layers.sort((a,b) => a.order - b.order).forEach(l => {
    ctx.globalAlpha = l.opacity;
    ctx.drawImage(canvases[l.id], 0, 0);
  });
  const link = document.createElement("a");
  link.download = "drawing.png";
  link.href = exportCanvas.toDataURL();
  link.click();
};