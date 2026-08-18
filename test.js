const axios = require('axios');

const ApiData = async () => {
  try {
    const response = await axios.get('https://api.nexray.eu.cc/ai/deepsearch?text=carikan+game+id+atau+place+id+nya+throw+a+coin+atau+fisch');
    return response.data;
  } catch (error) {
    return error.message;
  }
}

ApiData().then(console.log);
