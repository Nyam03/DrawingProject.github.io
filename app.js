import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Firebase 설정 (기존과 동일)
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

// 상태 변수
const roomId = "room1";
let currentLayer = "layer1";
let tool = "brush", color = "#000000", size = 5;
let layers = []; // {id, order, opacity}
let canvases = {}, contexts = {};
let scale = 1; // 줌 비율

// 🧱 레이어 생성
function createLayer(layerId) {
  const container = document.getElementById("canvasContainer");
  const canvas = document.createElement("canvas");
  
  // 16:9 실제 픽셀 해상도 설정 (고해상도 유지)
  canvas.width = 1920; 
  canvas.height = 1080;
  canvas.classList.add("layerCanvas");
  canvas.id = `canvas-${layerId}`;
  container.appendChild(canvas);

  canvases[layerId] = canvas;
  contexts[layerId] = canvas.getContext("2d");

  const newLayer = { id: layerId, order: layers.length, opacity: 1 };
  layers.push(newLayer);
  
  listenLayer(layerId);
  updateLayerUI();
}

// 🎨 레이어 UI 업데이트 (삭제/순서 이동 포함)
function updateLayerUI() {
  const list = document.getElementById("layersList");
  list.innerHTML = "";

  // order 기준 역순 정렬 (위에 있는 레이어가 리스트 상단)
  [...layers].sort((a, b) => b.order - a.order).forEach((layer, index) => {
    const div = document.createElement("div");
    div.className = `layerItem ${currentLayer === layer.id ? "active" : ""}`;
    div.innerHTML = `
      <div class="layer-top">
        <span>${layer.id}</span>
        <div class="layer-controls">
          <button class="small-btn up-btn">▲</button>
          <button class="small-btn down-btn">▼</button>
          <button class="small-btn del-btn">✕</button>
        </div>
      </div>
      <input type="range" min="0" max="1" step="0.1" value="${layer.opacity}">
    `;

    div.onclick = () => { currentLayer = layer.id; updateLayerUI(); };
    
    // 순서 변경 로직
    div.querySelector(".up-btn").onclick = (e) => { e.stopPropagation(); moveLayer(layer.id, 1); };
    div.querySelector(".down-btn").onclick = (e) => { e.stopPropagation(); moveLayer(layer.id, -1); };
    
    // 삭제 로직
    div.querySelector(".del-btn").onclick = (e) => { 
      e.stopPropagation(); 
      if(layers.length > 1) removeLayer(layer.id);
    };

    div.querySelector("input").oninput = (e) => {
      layer.opacity = e.target.value;
      canvases[layer.id].style.opacity = layer.opacity;
    };

    list.appendChild(div);
  });
}

// ↕️ 레이어 순서 이동
function moveLayer(id, direction) {
  const idx = layers.findIndex(l => l.id === id);
  const targetIdx = idx + direction;
  if (targetIdx >= 0 && targetIdx < layers.length) {
    [layers[idx].order, layers[targetIdx].order] = [layers[targetIdx].order, layers[idx].order];
    // 실제 DOM 순서 변경 (z-index)
    canvases[layers[idx].id].style.zIndex = layers[idx].order;
    canvases[layers[targetIdx].id].style.zIndex = layers[targetIdx].order;
    updateLayerUI();
  }
}

// ❌ 레이어 삭제
async function removeLayer(id) {
  if (!confirm(`${id}를 삭제하시겠습니까?`)) return;
  
  // Firebase 데이터 삭제는 선택사항 (여기서는 UI와 로컬 배열에서 제거)
  const canvas = canvases[id];
  canvas.remove();
  delete canvases[id];
  delete contexts[id];
  layers = layers.filter(l => l.id !== id);
  if (currentLayer === id) currentLayer = layers[0].id;
  updateLayerUI();
}

// 🔍 줌 기능
document.getElementById("viewport").onwheel = (e) => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  scale = Math.min(Math.max(0.2, scale * delta), 5); // 0.2배 ~ 5배 제한
  document.getElementById("canvasContainer").style.transform = `scale(${scale})`;
  document.getElementById("zoomLevel").innerText = `${Math.round(scale * 100)}%`;
};

// 🖱 좌표 보정 (줌 상태 고려)
function getMousePos(e) {
  const rect = canvases[currentLayer].getBoundingClientRect();
  // 브라우저 표시 크기와 실제 캔버스 해상도(1920) 비율 계산
  const scaleX = canvases[currentLayer].width / rect.width;
  const scaleY = canvases[currentLayer].height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

// ✍️ 드로잉 로직
let drawing = false, currentStroke = [];
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

document.addEventListener("mouseup", async () => {
  if (!drawing || currentStroke.length === 0) { drawing = false; return; }
  drawing = false;

  const ref = collection(db, "rooms", roomId, "pages", "page1", "layers", currentLayer, "strokes");
  await addDoc(ref, {
    points: currentStroke, color, size, tool, timestamp: Date.now()
  });
});

function drawSegment(ctx, points) {
  if (points.length < 2) return;
  const p1 = points[points.length - 2], p2 = points[points.length - 1];
  ctx.lineWidth = size;
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
}

// 📡 동기화
function listenLayer(layerId) {
  const ref = collection(db, "rooms", roomId, "pages", "page1", "layers", layerId, "strokes");
  onSnapshot(query(ref, orderBy("timestamp")), (snap) => {
    const ctx = contexts[layerId];
    ctx.clearRect(0, 0, 1920, 1080);
    snap.forEach(doc => {
      const s = doc.data();
      ctx.lineWidth = s.size;
      ctx.strokeStyle = s.color;
      ctx.globalCompositeOperation = s.tool === "eraser" ? "destination-out" : "source-over";
      ctx.beginPath();
      s.points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.stroke();
    });
  });
}

// 초기화
createLayer("layer1");

// 바인딩
document.getElementById("addLayer").onclick = () => createLayer(`layer${layers.length + 1}`);
document.getElementById("brush").onclick = (e) => { tool = "brush"; setActiveTool(e.target); };
document.getElementById("eraser").onclick = (e) => { tool = "eraser"; setActiveTool(e.target); };
document.getElementById("color").oninput = (e) => color = e.target.value;
document.getElementById("size").oninput = (e) => size = e.target.value;

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