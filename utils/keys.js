function normalizeDuration(duration) {
    const d = (duration || '').toString().trim().toLowerCase();
    if (!d || d === 'lifetime' || d === 'permanent' || d === 'perm') return 'lifetime';
    return d;
}

function computeExpiresAt(duration, fromDate = new Date()) {
    const d = normalizeDuration(duration);
    if (d === 'lifetime') return null;

    const match = d.match(/^(\d+)\s*([dhms])$/i);
    if (!match) return null; // unknown format → treat permanent

    const amount = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    const ms = {
        s: 1000,
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000
    }[unit];

    if (!ms) return null;
    return new Date(fromDate.getTime() + amount * ms).toISOString();
}

function isKeyExpired(keyRow) {
    if (!keyRow) return true;
    if (!keyRow.expires_at) {
        const d = normalizeDuration(keyRow.duration);
        if (d === 'lifetime') return false;
        // Legacy used keys without expires_at: compute from redeemed_at or created_at
        const base = keyRow.redeemed_at || keyRow.created_at;
        if (!base) return false;
        const computed = computeExpiresAt(keyRow.duration, new Date(base));
        if (!computed) return false;
        return Date.now() > new Date(computed).getTime();
    }
    return Date.now() > new Date(keyRow.expires_at).getTime();
}

function formatDurationLabel(duration) {
    const d = normalizeDuration(duration);
    if (d === 'lifetime') return 'Permanent';
    return d;
}

module.exports = {
    normalizeDuration,
    computeExpiresAt,
    isKeyExpired,
    formatDurationLabel
};
