# 한강 낚시 환경 대시보드

원본 HTML의 파란색·흰색 디자인과 지도 → 수위 그래프 → 날씨 → 인천 조석표 구성을 유지한 모바일 대시보드입니다.

## 게시

1. 이 폴더의 파일을 GitHub 저장소 main 브랜치에 올립니다.
2. Settings → Pages → Source를 **GitHub Actions**로 설정합니다.
3. Settings → Secrets and variables → Actions → New repository secret에서 `PUBLIC_DATA_API_KEY`를 등록합니다. 기상청 단기예보와 국립해양조사원 조석예보(고, 저조)에 활용 승인된 공공데이터포털 키를 사용합니다.
4. Actions → Refresh data and publish Pages → Run workflow를 실행합니다.
5. 성공한 배포의 URL을 확인합니다. API 신청서가 서비스 활용 홈페이지 URL을 요구한다면 이 접속 주소를 사용합니다.

API 키는 HTML·JavaScript·Git 기록에 넣지 않습니다. GitHub Actions가 키를 사용해 자료를 조회하고, 정상화된 공개 관측·예보 자료만 Pages에 게시합니다. 데이터 수집을 수행하려면 Node.js 22 이상이 필요하며 외부 패키지 설치는 필요하지 않습니다.

## 제공 상태

- 날씨: 기상청 초단기실황/초단기예보의 기온·풍속·풍향·1시간 강수량. 실제 조회 성공 시 표시합니다.
- 조석: 국립해양조사원 인천 고조·저조 시각과 높이. 한강 도착시각으로 환산하지 않습니다.
- 수위: 서비스명 및 호출 명세 확인 대기입니다. 임의 수위나 가짜 그래프를 표시하지 않습니다.
- AI: 현재 비활성입니다. Pages는 정적 호스팅이므로 버튼을 눌러 Gemini를 호출하려면 별도의 서버 연동이 필요합니다. Gemini 키는 이 초기 Pages 버전에 등록하지 않습니다.
- 댐 방류량·상류 강수·기상특보: 추가 서비스 연결 전입니다.

## 갱신과 해석

자동 작업은 15분마다 실행을 시도합니다. GitHub의 예약 작업은 지연되거나 누락될 수 있으며 공개 저장소가 60일간 활동이 없으면 비활성화될 수 있습니다. 정확한 주기의 실시간 서비스가 아닙니다. 페이지는 관측 시각을 표시하며 2시간 이상 지난 기상자료와 날짜가 지난 조석자료는 갱신 대기로 처리합니다. 새로고침은 마지막 게시 자료를 다시 읽습니다.

수위 관측소 값은 낚시 지점의 실제 수심이 아닙니다. 공식 통제와 특보를 확인해야 하며 이 화면으로 낚시 허용 여부나 현장 안전을 판정하지 않습니다.

출처:
- https://www.data.go.kr/data/15084084/openapi.do
- https://www.data.go.kr/data/15156018/openapi.do
- https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
