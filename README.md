# 식사 · 식후 · 산책

상암 누리꿈스퀘어를 기본 출발지로, 인원수에 맞는 식당 → 식후(카페·디저트·편의점) → 산책/실내 코스를 고르는 페이지입니다.

누리꿈스퀘어 1.5km 안은 `data/sangam.json`(2026-11-27 조사)을 쓰고, 그 밖은 OpenStreetMap 식당·편의점(`restaurants.json`, `stores.json`)으로 넘어갑니다. 그 경우 인원 맞춤은 추정입니다. 편의점 행사 음료는 기존 CU·이마트24 수집 자료를 음식 종류에 맞춰 보여 줍니다.

메뉴·가격이 자료에 없으면 메뉴 칸을 만들지 않습니다. `excluded`에 있는 장소는 화면에 나오지 않습니다.

```bash
python3 -m http.server 8765
npx playwright test
```
