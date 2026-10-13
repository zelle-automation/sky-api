/* eslint-disable */
// Generated scenic artwork used until real photos are added. Ported from the design preview.
function rng(seed){let s=seed%2147483647;if(s<=0)s+=2147483646;return()=>(s=s*16807%2147483647)/2147483647}
const PAL={
  dusk:{sky:["#0E1B3D","#3B3770","#C0687A","#F2B27A"],sun:"#FFD9A0",far:"#4B4170",near:"#141A35",water:["#2B2D5A","#0B1430"],glow:"#F6B983"},
  night:{sky:["#050B1E","#0E1F48","#27407A","#41588F"],sun:"#F3EBD2",far:"#1B2A55",near:"#070D22",water:["#13234A","#050B1E"],glow:"#9BB5FF",night:1},
  day:{sky:["#1B4F8A","#3E86C2","#8CC4E4","#DDEFF2"],sun:"#FFF6DA",far:"#5E8FB4",near:"#163A5C",water:["#1F84A6","#0E4D6E"],glow:"#FFFFFF"},
  gold:{sky:["#1A1E3F","#5B4A6C","#D49A62","#F6D49A"],sun:"#FFF0C9",far:"#7B5D63",near:"#22213A",water:["#6B5A72","#1D1F3C"],glow:"#FFD08A"},
  morning:{sky:["#4F7FB8","#9BBFE0","#F2C9B8","#FCE7CF"],sun:"#FFF7E3",far:"#8FA7C4",near:"#2E4A6B",water:["#6FA6CC","#2F6A93"],glow:"#FFE9C4"},
  teal:{sky:["#0B3550","#1F6E8C","#6FC0C8","#F1E1B8"],sun:"#FFF4D6",far:"#2E7186",near:"#0E3247",water:["#1AA0A8","#0A5367"],glow:"#FFF0C0"}
};
function scene(kind,pal,seed){
  const P=PAL[pal],r=rng(seed||7),W=800,H=1000,hz=640;let s="";
  s+=`<defs><linearGradient id="sk" x1="0" y1="0" x2="0" y2="1">${P.sky.map((c,i)=>`<stop offset="${[0,.4,.75,1][i]}" stop-color="${c}"/>`).join("")}</linearGradient>`+
     `<linearGradient id="wt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.water[0]}"/><stop offset="1" stop-color="${P.water[1]}"/></linearGradient>`+
     `<radialGradient id="gl"><stop offset="0" stop-color="${P.glow}" stop-opacity=".75"/><stop offset="1" stop-color="${P.glow}" stop-opacity="0"/></radialGradient></defs>`;
  s+=`<rect width="${W}" height="${H}" fill="url(#sk)"/>`;
  if(P.night){for(let i=0;i<90;i++)s+=`<circle cx="${r()*W}" cy="${r()*hz*.75}" r="${r()*1.6+.3}" fill="#fff" opacity="${r()*.7+.2}"/>`}
  const sx=kind==="domes"?560:220+r()*360, sy=P.night?170:hz-140-r()*120;
  s+=`<circle cx="${sx}" cy="${sy}" r="260" fill="url(#gl)"/><circle cx="${sx}" cy="${sy}" r="${P.night?34:52}" fill="${P.sun}"/>`;
  // far hills
  let d=`M0 ${hz}`;for(let x=0;x<=W;x+=40)d+=` L${x} ${hz-60-r()*90}`;s+=`<path d="${d} L${W} ${hz} Z" fill="${P.far}" opacity=".7"/>`;
  // water
  s+=`<rect y="${hz}" width="${W}" height="${H-hz}" fill="url(#wt)"/>`;
  for(let i=0;i<14;i++){const y=hz+12+i*i*1.6,w=120-i*6;s+=`<rect x="${sx-w/2+(r()-.5)*30}" y="${y}" width="${w}" height="2" rx="1" fill="${P.sun}" opacity="${.55-i*.035}"/>`}
  const N=P.near;
  if(kind==="mountains"){
    const pk=[[80,330],[260,250],[430,340],[600,220],[760,320]];
    let m=`M-20 ${hz}`;pk.forEach(([x,y],i)=>{m+=` L${x-90} ${y+140} L${x} ${y} L${x+90} ${y+150}`});s+=`<path d="${m} L${W+20} ${hz} Z" fill="${P.far}"/>`;
    pk.forEach(([x,y])=>{s+=`<path d="M${x-34} ${y+52} L${x} ${y} L${x+36} ${y+56} L${x+16} ${y+46} L${x+2} ${y+62} L${x-14} ${y+44} Z" fill="#F4F1EA" opacity=".92"/>`});
    let n=`M0 ${hz}`;for(let x=0;x<=W;x+=50)n+=` L${x} ${hz-20-r()*60}`;s+=`<path d="${n} L${W} ${hz} Z" fill="${N}"/>`;
    for(let i=0;i<26;i++){const x=r()*W,h=30+r()*50;s+=`<path d="M${x} ${hz-h-30} L${x-12} ${hz-10} L${x+12} ${hz-10} Z" fill="${N}"/>`}
    s+=`<rect y="${hz+150}" width="${W}" height="${H-hz-150}" fill="${N}"/>`;
  }
  if(kind==="city"||kind==="twin"){
    let x=0;while(x<W){const w=30+r()*50,h=90+r()*220;s+=`<rect x="${x}" y="${hz-h}" width="${w}" height="${h}" fill="${N}"/>`;
      for(let k=0;k<h/14;k++)for(let j=0;j<w/12;j++)if(r()>.62)s+=`<rect x="${x+4+j*12}" y="${hz-h+8+k*14}" width="4" height="5" fill="${P.glow}" opacity="${r()*.6+.25}"/>`;x+=w+2}
    if(kind==="twin"){[330,430].forEach(cx=>{s+=`<path d="M${cx-34} ${hz} L${cx-30} ${hz-380} L${cx-18} ${hz-440} L${cx-6} ${hz-470} L${cx-2} ${hz-560} L${cx+2} ${hz-560} L${cx+6} ${hz-470} L${cx+18} ${hz-440} L${cx+30} ${hz-380} L${cx+34} ${hz} Z" fill="${N}"/>`;for(let k=0;k<26;k++)s+=`<rect x="${cx-22}" y="${hz-370+k*14}" width="44" height="2" fill="${P.glow}" opacity=".45"/>`});s+=`<rect x="364" y="${hz-300}" width="32" height="8" fill="${N}"/>`}
    else{[[260,400,26],[520,330,36],[600,300,30]].forEach(([cx,h,w])=>{s+=`<path d="M${cx-w} ${hz} Q${cx-w*1.1} ${hz-h*.6} ${cx-w*.3} ${hz-h} Q${cx+w*.9} ${hz-h*.7} ${cx+w} ${hz} Z" fill="${N}"/>`;for(let k=0;k<h/18;k++)s+=`<rect x="${cx-w*.6}" y="${hz-h+30+k*18}" width="${w*1.2}" height="2" fill="${P.glow}" opacity=".5"/>`})}
  }
  if(kind==="domes"){
    const g=hz-10;s+=`<rect x="140" y="${g-120}" width="520" height="130" fill="${N}"/>`;
    [[400,170,110],[250,90,60],[550,90,60],[180,50,36],[620,50,36]].forEach(([cx,rw,rh])=>{s+=`<path d="M${cx-rw} ${g-110} Q${cx-rw} ${g-110-rh*1.5} ${cx} ${g-110-rh*1.55} Q${cx+rw} ${g-110-rh*1.5} ${cx+rw} ${g-110} Z" fill="${N}"/><rect x="${cx-2}" y="${g-110-rh*1.55-26}" width="4" height="26" fill="${N}"/>`});
    [110,690,300,500].forEach((x,i)=>{const h=i<2?420:340;s+=`<rect x="${x-9}" y="${g-h}" width="18" height="${h}" fill="${N}"/><rect x="${x-14}" y="${g-h+70}" width="28" height="8" fill="${N}"/><path d="M${x-9} ${g-h} L${x} ${g-h-60} L${x+9} ${g-h} Z" fill="${N}"/>`});
    for(let i=0;i<14;i++)s+=`<rect x="${170+i*35}" y="${g-60}" width="10" height="16" rx="5" fill="${P.glow}" opacity=".55"/>`;
  }
  if(kind==="tower"){ // clock tower skyline (Makkah)
    const g=hz;s+=`<path d="M300 ${g} L300 ${g-300} L330 ${g-330} L330 ${g-470} L400 ${g-540} L470 ${g-470} L470 ${g-330} L500 ${g-300} L500 ${g} Z" fill="${N}"/><rect x="396" y="${g-640}" width="8" height="100" fill="${N}"/><circle cx="400" cy="${g-420}" r="42" fill="${P.glow}" opacity=".9"/><circle cx="400" cy="${g-420}" r="34" fill="none" stroke="${N}" stroke-width="3"/><path d="M400 ${g-420} L400 ${g-446} M400 ${g-420} L418 ${g-410}" stroke="${N}" stroke-width="4"/>`;
    let x=0;while(x<W){const w=40+r()*60,h=80+r()*140;if(x<280||x>520)s+=`<rect x="${x}" y="${g-h}" width="${w}" height="${h}" fill="${N}"/>`;x+=w+3}
    for(let i=0;i<40;i++)s+=`<rect x="${r()*W}" y="${g-40-r()*150}" width="4" height="5" fill="${P.glow}" opacity=".5"/>`;
  }
  if(kind==="island"||kind==="villas"){
    s+=`<path d="M60 ${hz+6} Q200 ${hz-60} 360 ${hz+6} Z" fill="${N}"/>`;
    const palm=(x,y,h,lean)=>{let p=`<path d="M${x} ${y} Q${x+lean*.4} ${y-h*.6} ${x+lean} ${y-h}" stroke="${N}" stroke-width="7" fill="none"/>`;const tx=x+lean,ty=y-h;for(let a=0;a<7;a++){const an=-Math.PI+a*Math.PI/6+.1,l=70;p+=`<path d="M${tx} ${ty} Q${tx+Math.cos(an)*l*.6} ${ty+Math.sin(an)*l*.6-26} ${tx+Math.cos(an)*l} ${ty+Math.sin(an)*l*.4+28}" stroke="${N}" stroke-width="9" fill="none" stroke-linecap="round"/>`}return p};
    s+=palm(170,hz-10,170,30)+palm(240,hz-4,130,-26);
    if(kind==="villas"){for(let i=0;i<5;i++){const x=420+i*72,y=hz+40+i*10;s+=`<path d="M${x-30} ${y} L${x} ${y-34} L${x+30} ${y} Z" fill="${N}"/><rect x="${x-24}" y="${y}" width="48" height="16" fill="${N}"/><rect x="${x-10}" y="${y+4}" width="10" height="8" fill="${P.glow}" opacity=".7"/><rect x="${x-20}" y="${y+16}" width="3" height="30" fill="${N}"/><rect x="${x+17}" y="${y+16}" width="3" height="30" fill="${N}"/>`}s+=`<rect x="380" y="${hz+86}" width="420" height="5" fill="${N}"/>`}
    s+=`<path d="M0 ${H} L0 ${H-90} Q300 ${H-150} 560 ${H-110} Q700 ${H-90} 800 ${H-130} L800 ${H} Z" fill="#E9D3A8" opacity=".85"/>`;
  }
  if(kind==="desert"){
    s+=`<path d="M0 ${hz-30} Q200 ${hz-120} 420 ${hz-40} T800 ${hz-60} L800 ${H} L0 ${H} Z" fill="#B97A4A"/><path d="M0 ${hz+80} Q260 ${hz-30} 520 ${hz+60} T800 ${hz+40} L800 ${H} L0 ${H} Z" fill="#8E5634"/><path d="M0 ${hz+220} Q300 ${hz+120} 800 ${hz+230} L800 ${H} L0 ${H} Z" fill="${N}"/>`;
    s+=`<g fill="${N}"><ellipse cx="520" cy="${hz+40}" rx="22" ry="10"/><rect x="505" y="${hz+40}" width="3" height="22"/><rect x="532" y="${hz+40}" width="3" height="22"/><path d="M536 ${hz+36} q8 -18 16 -14 v8 h-6 z"/></g>`;
  }
  if(kind==="lake"){ // alpine lake with cabins
    const pk=[[150,300],[400,200],[650,280]];let m=`M-20 ${hz}`;pk.forEach(([x,y])=>{m+=` L${x-140} ${y+200} L${x} ${y} L${x+140} ${y+210}`});s+=`<path d="${m} L${W+20} ${hz} Z" fill="${P.far}"/>`;
    pk.forEach(([x,y])=>{s+=`<path d="M${x-50} ${y+70} L${x} ${y} L${x+52} ${y+74} L${x+20} ${y+60} L${x} ${y+80} L${x-20} ${y+58} Z" fill="#F4F1EA" opacity=".95"/>`});
    for(let i=0;i<40;i++){const x=r()*W,h=40+r()*70;s+=`<path d="M${x} ${hz-h} L${x-14} ${hz} L${x+14} ${hz} Z" fill="${N}"/>`}
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">${s}</svg>`;
}

module.exports={scene,PAL};
