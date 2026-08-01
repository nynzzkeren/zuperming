const PRODUCTS = {
    premium: {
        id: 'premium',
        name: 'Zuperming Premium',
        keyPrefix: 'ZUPER',
        brand: 'Zuperming',
        loaderFile: 'loader_template.lua',
        loaderRoute: '/loader',
        executeRoute: '/api/execute',
        adminScriptPath: '/admin/script',
        btnPrefix: 'btn_',
        modalRedeem: 'modal_redeem',
        roleEnv: 'BUYER_ROLE_ID'
    },
    service_provider: {
        id: 'service_provider',
        name: 'Service Provider',
        keyPrefix: 'ZSP',
        brand: 'Service Provider',
        loaderFile: 'loader_service_provider.lua',
        loaderRoute: '/loader/sp',
        executeRoute: '/api/sp/execute',
        adminScriptPath: '/admin/script/sp',
        btnPrefix: 'btn_sp_',
        modalRedeem: 'modal_sp_redeem',
        roleEnv: 'SP_BUYER_ROLE_ID'
    }
};

function getBaseUrl() {
    const raw = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    return raw.replace(/\/$/, '');
}

function getProduct(id) {
    return PRODUCTS[id] || null;
}

function getProductRoleId(product) {
    if (!product) return process.env.BUYER_ROLE_ID || null;
    // SP falls back to BUYER_ROLE_ID if SP_BUYER_ROLE_ID not set
    return process.env[product.roleEnv] || process.env.BUYER_ROLE_ID || null;
}

module.exports = { PRODUCTS, getBaseUrl, getProduct, getProductRoleId };
