import React, { useState, useEffect } from 'react'
import { get, post } from '../api'

export default function Claim({ code }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(null)
  useEffect(() => { get(`/api/claim/${code}`).then(setData).catch(e => setErr(e.message)) }, [code])
  async function claim() {
    try { const r = await post(`/api/claim/${code}`, {}); setDone(r) } catch (e) { setErr(e.message) }
  }
  return (
    <div className="claimWrap">
      <div className="claimCard">
        <div style={{ fontSize: 44 }}>🎟️</div>
        <h2>Claim Your Offer</h2>
        <div className="badge blue">Code: {code}</div>
        {err && <p style={{ color: 'red' }}>{err}</p>}
        {!data && !err && <p>Loading offer…</p>}
        {data && !done && <>
          {data.valid === false ? <p>⚠️ This code is expired or already used.</p> : <>
            <div style={{ fontSize: 36, fontWeight: 800, margin: '14px 0' }}>{data.discount}% OFF</div>
            <p><b>{data.outletName}</b><br />{data.campaignName}<br /><span className="muted">Expires at {data.expiresAt} (boarding close)</span></p>
            <button className="btn" style={{ width: '100%', padding: 14, fontSize: 16 }} onClick={claim}>Claim Now</button>
            <p className="small muted">Show this screen at the outlet. Redemption appears instantly in the Retailer dashboard.</p>
          </>}
        </>}
        {done && <div><div style={{ fontSize: 40 }}>✅</div><h3>Redeemed!</h3><p>Redemption ID: {done.redemptionId || 'confirmed'}<br />Enjoy your offer — check the Retailer dashboard, it just ticked up.</p></div>}
      </div>
    </div>
  )
}
