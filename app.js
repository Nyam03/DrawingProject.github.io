import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  deleteDoc,
  doc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// 🔑 Firebase 설정
const firebaseConfig = {
  apiKey: "AIzaSyAje85hdqJ9iEZuvL57ZYL2HJa8vUZcGBc",
  authDomain: "drawingproject-ae35d.firebaseapp.com",
  projectId: "drawingproject-ae35d",
  storageBucket: "drawingproject-ae35d.firebasestorage.app",
  messagingSenderId: "224466239154",
  appId: "1:224466239154:web:951dd5a55526c8edfa53ab",
  measurementId: "G-JJ4MQL2KDH"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// 🎯 전역 상태 관리
const roomId = "room1";
let currentPage = "page1";
let currentLayer = "layer1";
const maxLayers = 5;
const undoLimit = 20;

let layers = [];
let canvases = {};
let contexts = {};
let undoStack = [];
let redoStack = [];

// 🎨 드로잉 설정 (상단으로 이동)
let tool = "brush";
let color = "#000000";
let size = 5;
let drawing = false;
let currentStroke = [];

// 🧱 캔버스 생성 및 초기화
function createLayer(layerId) {
  const container = document.getElementById("canvasContainer");
  const canvas = document.createElement("canvas");
  
  // 컨테이너 크기에 맞게 조정
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;
  canvas.classList.add("layerCanvas");
  container.appendChild(canvas);

  canvases[layerId] = canvas;
  contexts[layerId] = canvas.getContext("2d");

  layers.push({
    id: layerId,
    order: layers.length,
    opacity: 1
  });

  listenLayer(layerId);
  updateLayerUI();
}

// 🎨 레이어 UI 업데이트 (선택 효과 포함)
function updateLayerUI() {
  const panel = document.getElementById("layers");
  panel.innerHTML = "";

  layers.sort((a, b) => a.order - b.order);

  layers.forEach((layer) => {
    const div = document.createElement("div");
    div.className = `layerItem ${currentLayer === layer.id ? "active" : ""}`;
    div.innerHTML = `
      <span>${layer.id}</span>
      <input type="range" min="0" max="1" step="0.1" value="${layer.opacity}">
    `;

    div.onclick = () => {
      currentLayer = layer.id;
      updateLayerUI(); // UI 갱신으로 active 클래스 적용
    };

    div.querySelector("input").oninput = (e) => {
      e.stopPropagation();
      layer.opacity = e.target.value;
      canvases[layer.id].style.opacity = layer.opacity;
    };

    panel.appendChild(div);
  });
}

// ➕ 레이어 추가 버튼
document.getElementById("addLayer").onclick = () => {
  if (layers.length >= maxLayers) return;
  const id = "layer" + (layers.length + 1);
  createLayer(id);
};

// 🎯 초기 실행
createLayer("layer1");

// 🖱 좌표 계산 함수 (사이드바 오차 보정)
function getMousePos(e) {
  const rect = canvases[currentLayer].getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  };
}

// ✍️ 드로잉 로직
document.addEventListener("mousedown", (e) => {
  if (e.target.closest("#canvasContainer")) {
    drawing = true;
    currentStroke = [];
  }
});

document.addEventListener("mousemove", (e) => {
  if (!drawing) return;
  const pos = getMousePos(e);
  currentStroke.push(pos);
  drawSegment(contexts[currentLayer], currentStroke);
});

// 마우스 업 리스너 통합 (중복 제거 및 Undo/Redo 관리)
document.addEventListener("mouseup", async () => {
  if (!drawing || currentStroke.length === 0) {
    drawing = false;
    return;
  }
  drawing = false;

  const ref = collection(db, "rooms", roomId, "pages", currentPage, "layers", currentLayer, "strokes");
  const data = {
    points: currentStroke,
    color,
    size,
    tool,
    timestamp: Date.now()
  };

  try {
    const docRef = await addDoc(ref, data);
    undoStack.push({ id: docRef.id, layer: currentLayer, data });
    if (undoStack.length > undoLimit) undoStack.shift();
    redoStack = []; 
  } catch (err) {
    console.error("저장 실패:", err);
  }
});

function drawSegment(ctx, points) {
  const l = points.length;
  if (l < 2) return;

  const p1 = points[l - 2];
  const p2 = points[l - 1];

  ctx.lineWidth = size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (tool === "eraser") {
    ctx.globalCompositeOperation = "destination-out";
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = color;
  }

  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
}

// 📡 실시간 동기화
function listenLayer(layerId) {
  const ref = collection(db, "rooms", roomId, "pages", currentPage, "layers", layerId, "strokes");
  const q = query(ref, orderBy("timestamp"));

  onSnapshot(q, (snap) => {
    const ctx = contexts[layerId];
    ctx.clearRect(0, 0, canvases[layerId].width, canvases[layerId].height);

    snap.forEach((doc) => {
      const s = doc.data();
      ctx.lineWidth = s.size;
      ctx.strokeStyle = s.color;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (s.tool === "eraser") {
        ctx.globalCompositeOperation = "destination-out";
      } else {
        ctx.globalCompositeOperation = "source-over";
      }

      ctx.beginPath();
      s.points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    });
  });
}

// 🔙 Undo / Redo 기능
async function undo() {
  const last = undoStack.pop();
  if (!last) return;
  redoStack.push(last);
  await deleteDoc(doc(db, "rooms", roomId, "pages", currentPage, "layers", last.layer, "strokes", last.id));
}

async function redo() {
  const item = redoStack.pop();
  if (!item) return;
  const ref = collection(db, "rooms", roomId, "pages", currentPage, "layers", item.layer, "strokes");
  const docRef = await addDoc(ref, item.data);
  undoStack.push({ id: docRef.id, layer: item.layer, data: item.data });
}

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key === "z") undo();
  if (e.ctrlKey && e.key === "y") redo();
});

// 💾 PNG 저장 기능 수정
document.getElementById("export").onclick = () => {
  const exportCanvas = document.createElement("canvas");
  const firstCanvas = canvases[layers[0].id];
  exportCanvas.width = firstCanvas.width;
  exportCanvas.height = firstCanvas.height;

  const ctx = exportCanvas.getContext("2d");
  layers.forEach(layer => {
    ctx.globalAlpha = layer.opacity;
    ctx.drawImage(canvases[layer.id], 0, 0);
  });

  const link = document.createElement("a");
  link.download = "collab-art.png";
  link.href = exportCanvas.toDataURL();
  link.click();
};

// 🛠 도구 바인딩
document.getElementById("brush").onclick = () => tool = "brush";
document.getElementById("eraser").onclick = () => tool = "eraser";
document.getElementById("color").oninput = (e) => color = e.target.value;