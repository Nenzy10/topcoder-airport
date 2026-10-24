# API & Data Contract (build coordination — canonical)

Base: same origin, JSON. Sim time = minutes since 00:00 (float), `clock` = "HH:MM".
Speeds: 1x = 1 sim-min / real-sec; 10x, 60x accordingly. Decision slot cadence: every 1 sim-minute per screen (recompute), events pushed via SSE.

## Endpoints
- GET /api/config → {name, tagline, currency, claimBaseUrl, languages:[en,ar], theme:{primary,accent}, flightSource}
- GET /api/state → {simMinutes, clock, speed, playing}
- POST /api/sim/control {action:"play"|"pause"|"speed"|"jump", speed?, minutes?} → state
- POST /api/sim/inject {type:"delay"|"gateChange"|"screenOffline"|"screenOnline", flightId?, minutes?, gate?, screenId?} → {ok, effects:[...]}
- GET /api/events (SSE) → events: {type:"tick"|"flight"|"decision"|"impression"|"redemption"|"incident"|"presence", data}
- GET /api/kpis → {screensOnlinePct, playsToday, impressionsToday, revenueToday, activeCampaigns, avgLatencyMs, decisionsLogged}
- GET /api/screens → [{id,name,terminal,zone,gate,size,orientation,status,latencyMs,x,y}]
- GET /api/map → {terminals:[{id,name,zones:[...]}], screens:[...with status], presence:[{zone,pax,intlPct,heat}]}
- GET /api/incidents → [{id,type,severity,entity,entityId,message,owner,status,createdAt(clock),ageMin}]
- POST /api/incidents/:id {status?, owner?}
- GET /api/master/:entity (vendors|outlets|airlines|locations|screens) → rows
- POST /api/master/:entity ; PUT /api/master/:entity/:id → row
- GET /api/feed-health → [{source,kind,status,msgsPerMin,lastMsg,adapter}]
- GET /api/perf → {apiP95Ms, playlistBuildMs, uptime7d:[{day,pct}], decisionMs}
- GET /api/flights?airline=&terminal= → [{id,airline,flightNo,dest,destName,std,etd,gate,terminal,status,delayMin,pax,loadFactor,aircraft}]
- GET /api/presence → [{zone,terminal,pax,next60,next120,intlPct,domPct,topDestinations:[{code,pax}],topNationalities:[{name,pct}],profile:{holiday,family,business,adults25_54,premium,dwellMedianMin}}]
- GET /api/outlets → [{id,name,type,terminal,zone,vendorId}]
- GET /api/retailer/:outletId/dashboard → {impressions,scans,redemptions,conversionPct,attributedRevenue,today:{...},live:true}
- GET /api/retailer/:outletId/flow → presence for outlet zone + next60/next120 + top lists
- GET /api/campaigns?advertiser= → [{id,name,advertiserId,advertiserName,outletId,status,creativeId,zones,audience:{destinations,domIntl,dwellMin,delayOnly},schedule:{start,end},budget,spent,segmentWeights:{intl,holiday,family,business,adults25_54,premium},boostRules}]
- POST /api/campaigns (body = campaign fields) → created campaign (status "pending" if approval needed else "active")
- POST /api/campaigns/:id/duplicate → copy (draft)
- POST /api/campaigns/:id/run-again → new active copy w/ fresh budget window
- GET /api/campaigns/:id/audience-preview?zone=&from=&to= → {matchPct, expectedImpressions, expectedRedemptions, crowdSize}
- GET /api/creatives → [{id,name,template,headline,sub,cta,lang,advertiserId}]
- POST /api/creatives
- GET /api/promos?outletId= → [{code,outletId,campaignId,discount,expiresAt(clock),flightId,redemptions,maxRedemptions,shareCode}]
- POST /api/promos {outletId,campaignId,discount,flightId} → {promo, qrDataUrl, claimUrl}
- GET /api/claim/:code → {valid, discount, outletName, expiresAt, campaignName}
- POST /api/claim/:code → {redeemed:true, redemptionId} (updates retailer dashboard via SSE)
- GET /api/history → [{campaignId,name,advertiserName,spend,impressions,redemptions,roi,days:30}]
- GET /api/triggers ; POST /api/triggers {condition:{dest,delayMin}, action:{discount,text}, zone} ; POST /api/triggers/:id/toggle
- GET /api/media/calendar → {screens:[{id,name}], hours:[5..23], cells:{"screenId|hour":{status:"booked"|"available"|"premium", price, campaignName}}}
- GET /api/media/yield → {occupancyPct, suggestions:[{screenId,hour,price,presence}], forecast7d:[{day,revenue}]}
- GET /api/media/approvals → [{campaignId,name,advertiserName,creative:{headline,...}, checklist:{logo:boolean,...}, status}]
- POST /api/media/approvals/:id {decision:"approve"|"reject", checklist}
- GET /api/media/advertisers → [{id,name,spend,running,underDelivering}]
- GET /api/airline/:code/flights → flights for airline today
- GET /api/airline/messages ; POST /api/airline/messages {airline,gate,text,kind,scheduleWindow}
- GET /api/airline/goodwill → {rules:[{airline,thresholdMin,offer,coFundOutletId,active}], fired:[{flightId,offer,at}]}
- POST /api/airline/goodwill {thresholdMin, offer, coFundOutletId, active}
- GET /api/airline/marketplace → [{id,outletName,offer,zone,price,accepted}]
- POST /api/airline/marketplace/:id/accept
- GET /api/decisions?screenId=&q=&limit= → [{id,at,screenId,zone,profile,winner:{campaignId,name,score},candidates:[{campaignId,name,match,boost,final,status}],reason,evidence:[{source,detail,freshnessSec}]}]
- POST /api/decisions/pin {screenId, campaignId, reason}
- GET /api/screen/:id/playlist → {screen, now:{campaign,creative,endsInSec}, queue:[...], contextFlights:[...], why:{profile,candidates,winner}, promo:{code,qrDataUrl,claimUrl,expiresInSec} | null}
- POST /api/genai/brief {brief, lang} → {creative:{headline,sub,cta,template,lang}, rationale}
- GET /api/recommend/slots?campaignId= → {slots:[{screenId,zone,day:"tomorrow",hour,predictedImpressions,score}] (top 3)}
- GET /api/packages ; POST /api/packages {name, screenIds, hours, discountPct}
- GET /api/report/advertiser/:id → printable summary object

## Canonical entities
Flight, GateAssignment, AircraftType, Terminal, Zone, Checkpoint, QueueMeasurement, Screen, Advertiser, Vendor, Outlet, Campaign, Creative, PromoCode, Impression, Redemption, ZonePresence, DecisionLog, Incident.

## Seed anchors (deterministic, mulberry32 seed 42)
- Airport: "Aurora International Airport" (fictional), currency USD configurable, T1+T2, gates 1..60 (T1:1-30, T2:31-60), zones per terminal: checkin, security, retail, gates-low, gates-high (gate 42 in T2 gates-high; screen catchment = gates zone-group ±: screens at gate G cover gates G-2..G+3).
- Airlines (fictional): XY "Xylo Air", ZQ "Zafiro Air", plus AB, KM, OR, PL, TR, VN, WJ, QD (10).
- WORKED EXAMPLE (must reproduce): Gate 42 (T2), sim 14:10:
  - XY501 → DXB, 240 pax, STD 14:25 gate 42, delayed 45 min (seeded delay), intl, holiday-heavy profile.
  - ZQ88 → MLE (beach), 180 pax, STD 14:50 gate 42, leisure.
  - Two domestic business flights at gates 44/45 (~160 pax each) to balance intl ≈57%.
  - Campaign "SkyScent Perfume — 15% off" (duty-free retailer, segments intl/holiday/adults25_54, delay boost rule 1.5x) must WIN at gate-42 screens at 14:10 with final ≈ 0.86; "ToyWorld B2G1" ≈ 0.52 next; "BizLounge pass" filtered/other-gates ≈ 0.21.
- ~220 flights generated (generator capable of ~900), 180 screens, 40 outlets, 25 campaigns, 30-day history rows.

## Scoring (engine)
match = Σ_seg w_seg · profile_seg / Σ_seg w_seg · ideal_seg-normalised → implemented as weighted mean of segment fits (0..1).
final = clamp01( match^0.7 · boost^0.55 · pacing ) where pacing from budget consumption (0.9..1.0 typical); calibration constants tuned so worked example lands 0.84–0.88. Filters before scoring: schedule window, approval status=active, zones, dom/intl, destination match if specified, minCrowd, budget remaining, brand-safety, competitor separation, frequency cap (same campaign ≤16 plays / screen / 10 min — 40% of 15-second slots), airline gate-priority boost 1.2 in own boarding window.
