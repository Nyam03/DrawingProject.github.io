import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, 
  limit, getDocs, updateDoc, where, writeBatch, setDoc
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

// --- 2. 상태 관리 ---
const roomId = "room1";
let currentUser = null;
let currentLayer = "layer1";
let tool = "brush", color = "#000000", size = 5;
let layers = []; 
let canvases = {}, contexts = {}, unsubscribes = {}; // 리스너 해제를 위한 객체 추가
let scale = 1, offset = { x: 0, y: 0 };
let drawing = false, currentStroke = [];

// --- 3. 인증 및 접속자 관리 ---
const loginOverlay = document.getElementById("loginOverlay");
const appDiv = document.getElementById("app");
const googleLoginBtn = document.getElementById("googleLoginBtn");

googleLoginBtn.onclick = () => signInWithPopup(auth, provider);

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    loginOverlay.style.display = "none";
    appDiv.style.display = "flex";
    
    // 접속자 정보 등록
    await setDoc(doc(db, "rooms", roomId, "users", user.uid), {
      name: user.displayName,
      photo: user.photoURL,
      lastActive: Date.now()
    });
    
    initApp();
    listenUsers();
    listenResetTrigger();
  } else {
    loginOverlay.style.display = "flex";
    appDiv.style.display = "none";
  }
});

function listenUsers() {
  const userListDiv = document.getElementById("userList");
  onSnapshot(collection(db, "rooms", roomId, "users"), (snap) => {
    userListDiv.innerHTML = "";
    snap.forEach(doc => {
      const u = doc.data();
      const chip = document.createElement("div");
      chip.className = "user-chip";
      chip.innerHTML = `<img src="${u.photo}">${u.name}`;
      userListDiv.appendChild(chip);
    });
  });
}

function initApp() {
  if (layers.length === 0) createLayer("layer1");
}

// --- 4. 레이어 관리 함수 ---
document.getElementById("addLayer").onclick = () => {
  if (layers.length >= 5) {
    alert("레이어는 최대 5개까지만 생성 가능합니다.");
    return;
  }
  const newId = `layer${Date.now()}`; // 고유 ID 생성
  createLayer(newId);
};

function createLayer(layerId) {
  const container = document.getElementById("canvasContainer");
  if (canvases[layerId]) return;

  const canvas = document.createElement("canvas");
  canvas.width = 1920; canvas.height = 1080;
  canvas.classList.add("layerCanvas");
  canvas.id = `canvas-${layerId}`;
  container.appendChild(canvas);

  canvases[layerId] = canvas;
  contexts[layerId] = canvas.getContext("2d");

  // 새 레이어를 항상 가장 위에 배치 (가장 높은 order)
  const maxOrder = layers.length > 0 ? Math.max(...layers.map(l => l.order)) : 0;
  const newLayer = { id: layerId, order: maxOrder + 1, opacity: 1 };
  layers.push(newLayer);
  
  currentLayer = layerId; // 생성 시 자동 선택
  listenLayer(layerId);
  updateLayerUI();
}

function deleteLayer(layerId) {
  if (layers.length <= 1) {
    alert("최소 하나의 레이어는 필요합니다.");
    return;
  }
  if (!confirm(`${layerId}를 삭제하시겠습니까?`)) return;

  // 1. 캔버스 제거
  const canvas = canvases[layerId];
  if (canvas) canvas.remove();

  // 2. 리스너 해제
  if (unsubscribes[layerId]) {
    unsubscribes[layerId]();
    delete unsubscribes[layerId];
  }

  // 3. 데이터 정리
  delete canvases[layerId];
  delete contexts[layerId];
  layers = layers.filter(l => l.id !== layerId);

  // 4. 현재 레이어가 삭제되었다면 다른 레이어 선택
  if (currentLayer === layerId) {
    currentLayer = layers[layers.length - 1].id;
  }

  updateLayerUI();
}

function moveLayer(layerId, direction) {
  const idx = layers.findIndex(l => l.id === layerId);
  if (idx === -1) return;

  // 실제 배열 순서가 아니라 'order' 값을 교체하여 정렬 순서를 변경
  const sorted = [...layers].sort((a, b) => a.order - b.order);
  const currentIdx = sorted.findIndex(l => l.id === layerId);

  if (direction === 'up' && currentIdx < sorted.length - 1) {
    const nextLayer = sorted[currentIdx + 1];
    const tempOrder = sorted[currentIdx].order;
    sorted[currentIdx].order = nextLayer.order;
    nextLayer.order = tempOrder;
  } else if (direction === 'down' && currentIdx > 0) {
    const prevLayer = sorted[currentIdx - 1];
    const tempOrder = sorted[currentIdx].order;
    sorted[currentIdx].order = prevLayer.order;
    prevLayer.order = tempOrder;
  }

  updateLayerUI();
}

function updateLayerUI() {
  const list = document.getElementById("layersList");
  list.innerHTML = "";

  // UI상으로는 order가 높은 것(위에 있는 것)이 먼저 보이게 정렬
  [...layers].sort((a, b) => b.order - a.order).forEach((layer) => {
    const div = document.createElement("div");
    div.className = `layerItem ${currentLayer === layer.id ? "active" : ""}`;
    
    div.innerHTML = `
      <div class="layer-top">
        <span>${layer.id === 'layer1' ? 'Base Layer' : layer.id.substring(0, 8)}</span>
        <div class="layer-controls">
          <button class="up-btn" title="위로">▲</button>
          <button class="down-btn" title="아래로">▼</button>
          <button class="del-btn" title="삭제">-</button>
        </div>
      </div>
      <input type="range" min="0" max="1" step="0.1" value="${layer.opacity}">
    `;

    // 이벤트 연결
    div.onclick = (e) => {
      if(e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT') {
        currentLayer = layer.id;
        updateLayerUI();
      }
    };

    div.querySelector(".up-btn").onclick = (e) => { e.stopPropagation(); moveLayer(layer.id, 'up'); };
    div.querySelector(".down-btn").onclick = (e) => { e.stopPropagation(); moveLayer(layer.id, 'down'); };
    div.querySelector(".del-btn").onclick = (e) => { e.stopPropagation(); deleteLayer(layer.id); };
    
    div.querySelector("input").oninput = (e) => {
      layer.opacity = e.target.value;
      canvases[layer.id].style.opacity = layer.opacity;
    };

    list.appendChild(div);
    
    // 캔버스의 실제 시각적 순서(z-index) 업데이트
    if (canvases[layer.id]) {
      canvases[layer.id].style.zIndex = layer.order;
    }
  });
}

// --- 5. 드로잉 및 리스너 로직 (unsubscribes 추가) ---

function listenLayer(layerId) {
  // 기존 리스너가 있다면 해제
  if (unsubscribes[layerId]) unsubscribes[layerId]();

  const q = query(
    collection(db, "strokes"),
    where("roomId", "==", roomId),
    where("layerId", "==", layerId),
    where("visible", "==", true),
    orderBy("timestamp", "asc")
  );

  unsubscribes[layerId] = onSnapshot(q, (snapshot) => {
    const ctx = contexts[layerId];
    if (!ctx) return;
    ctx.clearRect(0, 0, canvases[layerId].width, canvases[layerId].height);

    snapshot.docs.forEach((doc) => {
      const s = doc.data();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = s.size;
      ctx.strokeStyle = s.color;
      ctx.globalCompositeOperation = s.tool === "eraser" ? "destination-out" : "source-over";

      ctx.beginPath();
      s.points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    });
  });
}

// --- (나머지 Undo, Redo, Mouse Event, Reset 로직은 동일) ---
// 단, addDoc 시 layerId를 currentLayer로 정확히 전달하는지 확인
document.addEventListener("mouseup", async () => {
  if (!drawing || currentStroke.length === 0) { drawing = false; return; }
  drawing = false;

  await clearRedoStack();
  const ref = collection(db, "strokes"); // strokes 컬렉션으로 통일 (listenLayer의 query와 일치)
  await addDoc(ref, {
    roomId: roomId,
    layerId: currentLayer, // 현재 선택된 레이어 ID 저장
    points: currentStroke, 
    color, size, tool, 
    timestamp: Date.now(), 
    visible: true,
    userId: currentUser.uid,
    userName: currentUser.displayName
  });
});
// --- 5. 드로잉 로직 ---
function getMousePos(e) {
  const rect = canvases[currentLayer].getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvases[currentLayer].width / rect.width),
    y: (e.clientY - rect.top) * (canvases[currentLayer].height / rect.height)
  };
}

function drawSegment(ctx, points) {
  if (points.length < 2) return;
  const p1 = points[points.length - 2], p2 = points[points.length - 1];
  ctx.lineWidth = size;
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
  ctx.strokeStyle = color;
  ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
}
/*
function listenLayer(layerId) {
  const q = query(
    collection(db, "strokes"),
    where("roomId", "==", roomId),
    where("layerId", "==", layerId),
    where("visible", "==", true),
    orderBy("timestamp", "asc")
  );

  onSnapshot(q, (snapshot) => {
    const ctx = contexts[layerId];
    if (!ctx) return;
    ctx.clearRect(0, 0, canvases[layerId].width, canvases[layerId].height);

    snapshot.docs.forEach((doc) => {
      const s = doc.data();
      
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = s.size;
      ctx.strokeStyle = s.color;
      ctx.globalCompositeOperation = s.tool === "eraser" ? "destination-out" : "source-over";

      ctx.beginPath();
      s.points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    });
  });
}
*/
// --- 6. 사용자별 Undo / Redo (중요!) ---

async function undoLastStroke() {
  const ref = collection(db, "rooms", roomId, "pages", "page1", "layers", currentLayer, "strokes");
  // 내 ID(userId)이면서 보이는 것 중 마지막 데이터 검색
  const q = query(
    ref, 
    where("userId", "==", currentUser.uid), 
    where("visible", "==", true), 
    orderBy("timestamp", "desc"), 
    limit(1)
  );
  const snap = await getDocs(q);
  snap.forEach(async (d) => await updateDoc(doc(db, ref.path, d.id), { visible: false }));
}

async function redoLastStroke() {
  const ref = collection(db, "rooms", roomId, "pages", "page1", "layers", currentLayer, "strokes");
  // 내 ID(userId)이면서 숨겨진 것 중 마지막 데이터 검색
  const q = query(
    ref, 
    where("userId", "==", currentUser.uid), 
    where("visible", "==", false), 
    orderBy("timestamp", "desc"), 
    limit(1)
  );
  const snap = await getDocs(q);
  snap.forEach(async (d) => await updateDoc(doc(db, ref.path, d.id), { visible: true }));
}

async function clearRedoStack() {
  const ref = collection(db, "rooms", roomId, "pages", "page1", "layers", currentLayer, "strokes");
  const q = query(ref, where("userId", "==", currentUser.uid), where("visible", "==", false));
  const snap = await getDocs(q);
  const batch = writeBatch(db);
  snap.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

// --- 7. 이벤트 리스너 ---

document.addEventListener("mousedown", (e) => {
  if (e.target.closest("#canvasContainer") && currentUser) {
    drawing = true; currentStroke = [];
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

  await clearRedoStack();
  const ref = collection(db, "rooms", roomId, "pages", "page1", "layers", currentLayer, "strokes");
  await addDoc(ref, {
    points: currentStroke, color, size, tool, 
    timestamp: Date.now(), 
    visible: true,
    userId: currentUser.uid, // 선 데이터에 사용자 ID 저장
    userName: currentUser.displayName
  });
});

document.addEventListener("keydown", (e) => {
  const isCtrl = e.ctrlKey || e.metaKey;
  if (isCtrl && e.shiftKey && e.key.toLowerCase() === "z") {
    e.preventDefault(); redoLastStroke();
  } else if (isCtrl && e.key.toLowerCase() === "z") {
    e.preventDefault(); undoLastStroke();
  }
});

// 줌 및 기타 설정 (기존과 동일)
document.getElementById("viewport").onwheel = (e) => {
  e.preventDefault();
  const container = document.getElementById("canvasContainer");
  const rect = document.getElementById("viewport").getBoundingClientRect();
  const mouseX = e.clientX - rect.left, mouseY = e.clientY - rect.top;
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  const nextScale = Math.min(Math.max(0.1, scale * delta), 10);
  const worldX = (mouseX - offset.x) / scale, worldY = (mouseY - offset.y) / scale;
  scale = nextScale;
  offset.x = mouseX - worldX * scale; offset.y = mouseY - worldY * scale;
  container.style.transform = `translate(${offset.x}px, ${offset.y}px) scale(${scale})`;
  document.getElementById("zoomLevel").innerText = `${Math.round(scale * 100)}%`;
};

document.getElementById("brush").onclick = (e) => { tool = "brush"; setActiveTool(e.target); };
document.getElementById("eraser").onclick = (e) => { tool = "eraser"; setActiveTool(e.target); };
document.getElementById("color").oninput = (e) => color = e.target.value;
document.getElementById("size").oninput = (e) => updateBrushSize(e.target.value);
document.getElementById("sizeRange").oninput = (e) => updateBrushSize(e.target.value);

function updateBrushSize(val) {
  size = Math.min(Math.max(parseInt(val) || 1, 1), 100);
  document.getElementById("size").value = size;
  document.getElementById("sizeRange").value = size;
}

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
  link.download = "drawing.png"; link.href = exportCanvas.toDataURL(); link.click();
};

// 리셋 버튼 이벤트 리스너
const resetBtn = document.getElementById('reset-btn');

resetBtn.addEventListener('click', async () => {
  if (!confirm("정말로 전체 캔버스를 초기화하시겠습니까?")) return;

  try {
    let totalDeleted = 0;

    for (const layer of layers) {
      const ref = collection(
        db,
        "rooms", roomId,
        "pages", "page1",
        "layers", layer.id,
        "strokes"
      );

      const snap = await getDocs(ref);

      if (!snap.empty) {
        const batch = writeBatch(db);

        snap.forEach((docSnap) => {
          batch.delete(docSnap.ref);
          totalDeleted++;
        });

        await batch.commit();
      }
    }

    if (totalDeleted === 0) {
      alert("이미 비어있는 상태입니다.");
      return;
    }
    await setDoc(doc(db, "rooms", roomId), {
      resetAt: Date.now()
    }, { merge: true });
    
    alert("캔버스가 완전히 초기화되었습니다.");

  } catch (error) {
    console.error("초기화 실패:", error);
    alert("초기화 실패: " + error.message);
  }
});

function clearAllCanvases() {
  Object.keys(contexts).forEach(layerId => {
    const ctx = contexts[layerId];
    const canvas = canvases[layerId];
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  });
}

function listenResetTrigger() {
  onSnapshot(doc(db, "rooms", roomId), (snap) => {
    const data = snap.data();
    if (!data) return;

    // resetAt 값이 있으면 무조건 클리어
    if (data.resetAt) {
      clearAllCanvases();
    }
  });
}