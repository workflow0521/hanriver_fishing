# GitHub Pages 배포

공개 주소: https://workflow0521.github.io/hanriver_fishing/

Settings → Pages에서 Source를 **GitHub Actions**로 설정합니다. 기본 브랜치에 커밋하거나 Actions → **Refresh data and publish Pages** → **Run workflow**를 실행하면 화면을 빌드하고 확인한 뒤 `site/`를 게시합니다. 예약 실행은 약 15분 간격으로 시도합니다.

Settings → Secrets and variables → Actions의 저장소 비밀:

| 이름 | 사용처 |
| --- | --- |
| `PUBLIC_DATA_API_KEY` | 승인받은 기상청 단기예보 및 국립해양조사원 인천 조석 API |
| `HRFCO_API_KEY` | 한강홍수통제소 수위·방류·강수 자료 |
| `GEMINI_API_KEY` | 선택 사항. 수동 실행에서 `publish_advice`를 선택할 때만 사용 |

`GEMINI_MODEL` 저장소 변수는 선택 사항입니다. API 키를 저장소 파일이나 브라우저 코드에 넣지 않습니다. 공개 응답은 `site/data/snapshot.json`으로만 배포하며 이 파일은 커밋하지 않습니다. 지난 배포의 실제 수위는 최대 24시간까지 복원할 수 있고, 오래된 자료는 관측 시각과 함께 표시합니다.

홍수통제소 API 연결이 지연되면 같은 기관의 [공개 수문자료 표](https://www.hrfco.go.kr/sumun/waterlevelList.do)에서 동일 관측소·단위의 10분 자료를 조회합니다.

GitHub Pages에는 요청을 처리하는 자체 서버가 없습니다. 방문자의 새로고침은 마지막 게시본을 다시 조회합니다. 실시간 생성형 AI 요청은 실행하지 않습니다. 예약 실행이 비활성화된 경우 Actions 화면에서 다시 활성화하고 수동 실행하세요.
