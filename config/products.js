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

    freemium: {
        id: 'freemium',
        name: 'Zuperming Freemium',
        keyPrefix: 'ZFREE',
        brand: 'Zuperming Freemium',
        loaderFile: 'loader_freemium.lua',
        loaderRoute: '/loader/free',
        executeRoute: '/api/free/execute',
        adminScriptPath: '/admin/script/free',
        btnPrefix: 'btn_free_',
        modalRedeem: 'modal_free_redeem',
        roleEnv: 'FREE_BUYER_ROLE_ID'
    },
    testing_dev: {
        id: 'testing_dev',
        name: 'Zuperming Developer',
        keyPrefix: 'ZDEV',
        brand: 'Zuperming Developer',
        loaderFile: 'loader_dev.lua',
        loaderRoute: '/loader/dev',
        executeRoute: '/api/dev/execute',
        adminScriptPath: '/admin/script/dev',
        btnPrefix: 'btn_dev_',
        modalRedeem: 'modal_dev_redeem',
        roleEnv: 'DEVELOPER_ROLE_ID'
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
    return process.env[product.roleEnv] || process.env.BUYER_ROLE_ID || null;
}

function getFreemiumGetKeyUrl() {
    return (process.env.FREEMIUM_GETKEY_URL || `${getBaseUrl()}/get-key`).replace(/\/$/, '');
}

function getSupportUrl() {
    return process.env.SUPPORT_URL || process.env.SUGGESTION_URL || 'https://discord.gg/';
}

module.exports = {
    PRODUCTS,
    getBaseUrl,
    getProduct,
    getProductRoleId,
    getFreemiumGetKeyUrl,
    getSupportUrl
};
