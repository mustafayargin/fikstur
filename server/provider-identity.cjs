'use strict';
const {parseDate}=require('./policy.cjs');
function footballTeamKey(name){
 const n=String(name||'').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').replace(/[^a-z0-9]/g,'');
 const aliases={corum:'corum',corumfk:'corum',corumspor:'corum',caykurrizespor:'rizespor',istanbulbasaksehir:'basaksehir',istanbulbasaksehirfk:'basaksehir',basaksehirfk:'basaksehir',besiktasjk:'besiktas',fenerbahcesk:'fenerbahce',galatasaraysk:'galatasaray',gaziantepfk:'gaziantep',genclerbirligisk:'genclerbirligi',erzurumsporfk:'erzurumspor',bberzurumspor:'erzurumspor',amed:'amedspor',amedsporfk:'amedspor',amedsk:'amedspor',alanya:'alanyaspor'};
 return aliases[n]||n;
}
function eventMatchesMatch(event,row,weekNumber){
 const id=String(row.apiId||''),other=String(event.idEvent||'');
 if(id&&id===other)return true;
 const cross=id&&id.startsWith('bsd_')!==other.startsWith('bsd_');
 if(id&&!cross)return false;
 if(footballTeamKey(event.strHomeTeam)!==footballTeamKey(row.homeTeam||row.evSahibi)||footballTeamKey(event.strAwayTeam)!==footballTeamKey(row.awayTeam||row.deplasman))return false;
 if(!cross)return true;
 const round=Number(event.intRound),date=parseDate(row.date||row.tarih);
 const remote=Date.parse(`${event.dateEvent}T${event.strTime||'00:00:00'}Z`);
 return round===Number(weekNumber)&&Number.isFinite(date)&&Number.isFinite(remote)&&Math.abs(date-remote)<=3*86400000;
}
module.exports={footballTeamKey,eventMatchesMatch};
