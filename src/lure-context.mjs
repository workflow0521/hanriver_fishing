import {kst} from './data.mjs';
export const COMMUNITY_CHECKED_AT='2026-10-15';
export const OUNCE_SIZES=[['1/32oz',0.9],['1/16oz',1.8],['3/32oz',2.7],['1/8oz',3.5],['3/16oz',5.3],['1/4oz',7.1],['3/8oz',10.6],['1/2oz',14.2]];
export function koreaSeason(now=Date.now()){
 const date=kst(new Date(now)),month=Number(date.slice(4,6)),day=Number(date.slice(6,8)),season=month>=3&&month<=5?'봄':month>=6&&month<=8?'여름':month>=9&&month<=11?'가을':'겨울';
 return {date:date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6,8),year:Number(date.slice(0,4)),month,day,season,period:day<=10?'초순':day<=20?'중순':'하순',label:month+'월 '+(day<=10?'초순':day<=20?'중순':'하순')+' · 한국 '+season,timezone:'Asia/Seoul'};
}
const reports=[
 {id:'han-bass-202210',species:['bass'],title:'한강 망원·양화 배스 루어 조행기',url:'https://lazykim.tistory.com/78',postedAt:'2023-02-19',fishedAt:'2022-10-03',month:10,region:'한강 망원·양화',rig:'1/16oz 지그헤드 + 미트헤드 웜 / 씨테일 프리리그',result:'작은 호핑·드래깅으로 배스 히트한 개인 조행 사례',limits:'과거 10월 개인 사례. 제휴 링크·상점이 있어 대중적 인기 통계가 아님.'},
 {id:'han-gangjunchi-202210',species:['gangjunchi'],title:'양화 강준치 지그헤드 조행 사례',url:'https://lazykim.tistory.com/78',postedAt:'2023-02-19',fishedAt:'2022-10-06',month:10,region:'한강 양화',rig:'1/16oz 지그헤드 + 2인치 아이그럽',result:'10월 3일 조행으로부터 3일 뒤 강준치 조과를 기록',limits:'조행일은 본문의 상대 날짜에서 계산. 과거 개인 사례이며 현재 입질·인기를 입증하지 않음.'},
 {id:'han-megi-202109',species:['megi'],title:'탄천합수부 메기 루어 조행기',url:'https://aanrt.tistory.com/75',postedAt:'2021-09-26',fishedAt:null,month:9,region:'한강 탄천합수부',rig:'1/16oz 지그헤드 + 2인치 지렁이웜',result:'메기 루어 조과를 기록한 개인 경험',limits:'9월 게시 사례이며 정확한 조행일 미상. 글의 물때 경험을 현재 한강 들물·날물 규칙으로 일반화할 수 없음.'},
 {id:'han-sogari-202504',species:['sogari'],title:'이촌 쏘가리 야간 지그헤드 조행기',url:'https://lazykim.tistory.com/123',postedAt:'2025-04-02',fishedAt:'2025-04-01',month:4,region:'한강 이촌',rig:'1/16oz 지그헤드 + 섀드웜',result:'바닥 접촉 후 호핑으로 쏘가리 조과 기록',limits:'봄 사례이며 작성자는 웜 브랜드 운영자. 가을 인기나 현재 조과 근거로 바꿔 말하지 않음.'},
 {id:'han-october-2013',species:['sogari','jeomnongeo'],title:'잠실 10월 쏘가리·점농어 공개 조행기',url:'https://gall.dcinside.com/board/view/?id=fishing&no=158081',postedAt:'2013-10-31',fishedAt:null,month:10,region:'한강 잠실',rig:'3인치 웜 언급. 정확한 지그헤드 무게는 원문 오기로 확인 불가',result:'작성자가 쏘가리 3수와 전날 점농어 사진을 게시',limits:'매우 오래된 10월 자료. 본문상 쏘가리 10월31일·점농어 전날 10월30일이며 통합 조행일은 미기재. 원문 8/1온스 표기를 1/8oz로 임의 확정 금지. 현재 출현·대중적 인기를 증명하지 않음.'},
 {id:'han-jeomnongeo-202607',species:['jeomnongeo'],title:'탄천합수부 점농어 웜 조과 공유',url:'https://gall.dcinside.com/board/view/?id=fishing&no=721651',postedAt:'2026-07-19',fishedAt:null,month:7,region:'한강 탄천합수부',rig:'웜 사용 언급. 종류·지그헤드 무게는 확인 불가',result:'점농어 2마리 조과 공유. 확인 당시 추천 13·댓글 18',limits:'여름 게시물이고 정확 조행일 미상. 댓글 수는 채비 효과나 10월 인기를 증명하지 않음.'}
];
export function communityFor(species,season=koreaSeason()){
 const sameSeason=month=>(month>=3&&month<=5?'봄':month>=6&&month<=8?'여름':month>=9&&month<=11?'가을':'겨울')===season.season;
 const candidates=reports.filter(r=>r.species.includes(species)&&r.postedAt<=season.date),rank=r=>r.month===season.month?0:sameSeason(r.month)?1:2;
 const selected=candidates.sort((a,b)=>rank(a)-rank(b)||b.postedAt.localeCompare(a.postedAt)).slice(0,2).map(r=>({...r,match:r.month===season.month?'과거 같은 달 사례':sameSeason(r.month)?'같은 계절의 다른 달 사례':'다른 계절의 채비 사용 사례'}));
 return {mode:'curated',checkedAt:COMMUNITY_CHECKED_AT,notice:'직접 확인한 공개 조행기 참고. 실시간 인기·현재 조과 통계가 아니며 게시일과 실제 조행일을 구분합니다.',recentEvidence:'최근 30일 한강 조과·채비 반응 근거는 부족합니다.',reports:selected};
}
