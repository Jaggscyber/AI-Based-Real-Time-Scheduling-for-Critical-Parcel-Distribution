const mongoose = require('mongoose');
const Driver = require('./models/driverModel');
const Delivery = require('./models/deliveryModel');
const User = require('./models/userModel');
const Route = require('./models/routeModel');

// ─── 100 realistic Chennai delivery locations ───────────────────────────────────
const chennaiDeliveries = [
    // North Chennai
    { name: "Anand Textiles", phone: "9840001001", addr: "15, Mint Street, Sowcarpet, North Chennai", lng: 80.2793, lat: 13.0924, area: "urban", zone: "North Chennai" },
    { name: "Raj Pharma", phone: "9841001002", addr: "32, Bharathi Salai, Perambur, North Chennai", lng: 80.2490, lat: 13.1175, area: "urban", zone: "North Chennai" },
    { name: "Priya Silks", phone: "9842001003", addr: "78, Big Street, Triplicane, Chennai", lng: 80.2783, lat: 13.0605, area: "urban", zone: "Central Chennai" },
    { name: "Murugan Steel", phone: "9843001004", addr: "12, Sathangadu Industrial Estate, Ambattur", lng: 80.1658, lat: 13.1100, area: "industrial", zone: "West Chennai" },
    { name: "Kavya Electronics", phone: "9844001005", addr: "56, Anna Nagar 2nd Main Road, Chennai", lng: 80.2101, lat: 13.0851, area: "urban", zone: "West Chennai" },
    { name: "SRM Logistics", phone: "9845001006", addr: "9, T.H. Road, Tiruvottiyur, Chennai", lng: 80.3152, lat: 13.1511, area: "urban", zone: "North Chennai" },
    { name: "Lakshmi Grocery", phone: "9846001007", addr: "24, Kolathur Main Road, Kolathur, Chennai", lng: 80.2218, lat: 13.1189, area: "urban", zone: "North Chennai" },
    { name: "Selvam Hardware", phone: "9847001008", addr: "44, Red Hills Road, Ambattur, Chennai", lng: 80.1727, lat: 13.1280, area: "suburban", zone: "West Chennai" },
    { name: "Vijaya Catering", phone: "9848001009", addr: "33, Pulla Avenue, Perambur, Chennai", lng: 80.2399, lat: 13.1263, area: "urban", zone: "North Chennai" },
    { name: "Bharath Auto Parts", phone: "9849001010", addr: "67, Kasturibai Nagar, Adambakkam", lng: 80.2034, lat: 12.9907, area: "urban", zone: "South Chennai" },

    // South Chennai / Adyar / Velachery
    { name: "Adyar Ananda Bhavan", phone: "9840002001", addr: "32, Lattice Bridge Road, Adyar, Chennai", lng: 80.2550, lat: 13.0062, area: "urban", zone: "South Chennai" },
    { name: "Coastal Seafood", phone: "9841002002", addr: "12, Besant Nagar 1st Cross St, Chennai", lng: 80.2668, lat: 12.9989, area: "urban", zone: "South Chennai" },
    { name: "Velachery Mart", phone: "9842002003", addr: "78, Vijaya Nagar, Velachery, Chennai", lng: 80.2188, lat: 12.9783, area: "urban", zone: "South Chennai" },
    { name: "Lotus Flowers", phone: "9843002004", addr: "45, 1st Main Rd, Gandhinagar, Adyar", lng: 80.2499, lat: 13.0075, area: "urban", zone: "South Chennai" },
    { name: "Raj Jewels", phone: "9844002005", addr: "22, Thiruvanmiyur Main Rd, Chennai", lng: 80.2582, lat: 12.9845, area: "urban", zone: "South Chennai" },
    { name: "Deepika Boutique", phone: "9845002006", addr: "11, Kasturiranganpuram, Adyar, Chennai", lng: 80.2530, lat: 13.0017, area: "urban", zone: "South Chennai" },
    { name: "Shankar Medicals", phone: "9846002007", addr: "99, Santhome High Rd, Mylapore, Chennai", lng: 80.2730, lat: 13.0338, area: "urban", zone: "South Chennai" },
    { name: "SSB Supermarket", phone: "9847002008", addr: "15, Kottivakkam, ECR, Chennai", lng: 80.2740, lat: 12.9620, area: "urban", zone: "South Chennai" },
    { name: "Sindhu Fashion", phone: "9848002009", addr: "38, Radhakrishnan Salai, Mylapore, Chennai", lng: 80.2671, lat: 13.0358, area: "urban", zone: "Central Chennai" },
    { name: "Metro Bakery", phone: "9849002010", addr: "5, LB Road, Adyar, Chennai", lng: 80.2563, lat: 13.0040, area: "urban", zone: "South Chennai" },

    // T. Nagar / Nungambakkam / Kodambakkam
    { name: "KG Collections", phone: "9840003001", addr: "120, Pondy Bazaar, T. Nagar, Chennai", lng: 80.2320, lat: 13.0418, area: "urban", zone: "Central Chennai" },
    { name: "Nalli Silks", phone: "9841003002", addr: "9, Nageswara Rao Pk Rd, T. Nagar, Chennai", lng: 80.2303, lat: 13.0384, area: "urban", zone: "Central Chennai" },
    { name: "Kumaran Stores", phone: "9842003003", addr: "42, North Usman Road, T. Nagar, Chennai", lng: 80.2356, lat: 13.0395, area: "urban", zone: "Central Chennai" },
    { name: "Pothy's Textiles", phone: "9843003004", addr: "116, South Usman Road, T. Nagar, Chennai", lng: 80.2337, lat: 13.0389, area: "urban", zone: "Central Chennai" },
    { name: "Nungambakkam Florist", phone: "9844003005", addr: "25, Nungambakkam High Rd, Chennai", lng: 80.2476, lat: 13.0590, area: "urban", zone: "Central Chennai" },
    { name: "Woodlands Restaurant", phone: "9845003006", addr: "5, Royapettah High Rd, Chennai", lng: 80.2655, lat: 13.0516, area: "urban", zone: "Central Chennai" },
    { name: "Sundar Book House", phone: "9846003007", addr: "88, Anna Salai, Chennai", lng: 80.2701, lat: 13.0544, area: "urban", zone: "Central Chennai" },
    { name: "Vega Electronics", phone: "9847003008", addr: "14, Khader Nawaz Khan Rd, Nungambakkam", lng: 80.2462, lat: 13.0572, area: "urban", zone: "Central Chennai" },
    { name: "Kodambakkam Spares", phone: "9848003009", addr: "56, Arcot Road, Kodambakkam, Chennai", lng: 80.2193, lat: 13.0522, area: "urban", zone: "Central Chennai" },
    { name: "Surya Optical", phone: "9849003010", addr: "7, Valasaravakkam Main Rd, Chennai", lng: 80.1742, lat: 13.0429, area: "urban", zone: "West Chennai" },

    // Porur / Ambattur / Avadi
    { name: "Porur Dairy", phone: "9840004001", addr: "23, Porur Main Rd, Porur, Chennai", lng: 80.1570, lat: 13.0346, area: "suburban", zone: "West Chennai" },
    { name: "Ambattur Textiles", phone: "9841004002", addr: "45, Ambattur Industrial Estate, Chennai", lng: 80.1499, lat: 13.1156, area: "industrial", zone: "West Chennai" },
    { name: "Poonamallee Fresh", phone: "9842004003", addr: "12, Poonamallee High Rd, Poonamallee, Chennai", lng: 80.0916, lat: 13.0474, area: "suburban", zone: "West Chennai" },
    { name: "Avadi Medical Store", phone: "9843004004", addr: "7, MTH Road, Avadi, Chennai", lng: 80.0972, lat: 13.1155, area: "suburban", zone: "North-West Chennai" },
    { name: "Chennai Gold Palace", phone: "9844004005", addr: "34, GST Road, Chromepet, Chennai", lng: 80.1374, lat: 12.9521, area: "suburban", zone: "South-West Chennai" },
    { name: "Manali Cement Works", phone: "9845004006", addr: "67, Manali New Town, Chennai", lng: 80.2624, lat: 13.1656, area: "industrial", zone: "North Chennai" },

    // OMR / Sholinganallur / Perungudi
    { name: "Sholinganallur Sweets", phone: "9840005001", addr: "15, OMR, Sholinganallur, Chennai 600119", lng: 80.2270, lat: 12.9010, area: "urban", zone: "South Chennai" },
    { name: "Perungudi Logistics", phone: "9841005002", addr: "32, Elcot SEZ, Perungudi, Chennai", lng: 80.2411, lat: 12.9636, area: "industrial", zone: "South Chennai" },
    { name: "OMR Fresh Mart", phone: "9842005003", addr: "88, Old Mahabalipuram Rd, Karapakkam", lng: 80.2298, lat: 12.8877, area: "suburban", zone: "South Chennai" },
    { name: "Tidel Park Canteen", phone: "9843005004", addr: "4, Rajiv Gandhi Salai, Taramani, Chennai", lng: 80.2422, lat: 12.9881, area: "urban", zone: "South Chennai" },
    { name: "Thoraipakkam Medicals", phone: "9844005005", addr: "56, 100 Feet Rd, Thoraipakkam, Chennai", lng: 80.2312, lat: 12.9340, area: "urban", zone: "South Chennai" },
    { name: "Navalur IT Park Cafe", phone: "9845005006", addr: "20, Navallur, OMR, Chennai 600130", lng: 80.2253, lat: 12.8494, area: "suburban", zone: "South Chennai" },
    { name: "Siruseri Tech Store", phone: "9846005007", addr: "5, SIPCOT IT Park, Siruseri, Chennai", lng: 80.2196, lat: 12.8233, area: "suburban", zone: "South Chennai" },

    // Tambaram / Chromepet / Pallavaram
    { name: "Tambaram Textiles", phone: "9840006001", addr: "44, Tambaram Sanatorium, Tambaram, Chennai", lng: 80.1199, lat: 12.9249, area: "suburban", zone: "South-West Chennai" },
    { name: "Chromepet Superstore", phone: "9841006002", addr: "22, St Thomas Mount, Chromepet, Chennai", lng: 80.1365, lat: 12.9591, area: "suburban", zone: "South-West Chennai" },
    { name: "Pallavaram Mini Mart", phone: "9842006003", addr: "11, Pallavaram Main Rd, Pallavaram, Chennai", lng: 80.1519, lat: 12.9715, area: "suburban", zone: "South-West Chennai" },
    { name: "Vandalur Zoo Canteen", phone: "9843006004", addr: "Near Zoological Park, Vandalur, Chennai", lng: 80.0809, lat: 12.8939, area: "rural", zone: "South-West Chennai" },
    { name: "Mudichur Pharmacy", phone: "9844006005", addr: "67, Mudichur Main Rd, Mudichur, Chennai", lng: 80.0671, lat: 12.9200, area: "rural", zone: "South-West Chennai" },

    // Marina / George Town / Triplicane
    { name: "Marina Beach Snacks", phone: "9840007001", addr: "1, Beach Rd, Marina Beach, Chennai 600005", lng: 80.2824, lat: 13.0527, area: "urban", zone: "Central Chennai" },
    { name: "George Town Silks", phone: "9841007002", addr: "77, Linghi Chetty St, George Town, Chennai", lng: 80.2850, lat: 13.0909, area: "urban", zone: "North Chennai" },
    { name: "Parry's Corner Mart", phone: "9842007003", addr: "3, NSC Bose Rd, Parrys, Chennai 600001", lng: 80.2894, lat: 13.0882, area: "urban", zone: "North Chennai" },
    { name: "Triplicane Grocery", phone: "9843007004", addr: "45, Triplicane High Rd, Chennai 600005", lng: 80.2793, lat: 13.0636, area: "urban", zone: "Central Chennai" },
    { name: "Royapuram Fish Market", phone: "9844007005", addr: "12, Royapuram Fisheries, Chennai 600013", lng: 80.2929, lat: 13.1109, area: "urban", zone: "North Chennai" },

    // Pallikaranai / Medavakkam / Sholinganallur extended
    { name: "Pallikaranai Sweets", phone: "9840008001", addr: "9, Old Pallikaranai Rd, Pallikaranai, Chennai", lng: 80.2137, lat: 12.9375, area: "urban", zone: "South Chennai" },
    { name: "Medavakkam Hardware", phone: "9841008002", addr: "55, Medavakkam Main Rd, Chennai 600100", lng: 80.1950, lat: 12.9264, area: "urban", zone: "South Chennai" },
    { name: "Keelkattalai Dairy", phone: "9842008003", addr: "23, Keelkattalai, GST Rd, Chennai 600117", lng: 80.1780, lat: 12.9374, area: "suburban", zone: "South-West Chennai" },
    { name: "Kamaraj Medicals", phone: "9843008004", addr: "7, Rajakilpakkam, Tambaram, Chennai", lng: 80.1148, lat: 12.9177, area: "suburban", zone: "South-West Chennai" },

    // Egmore / Kilpauk / Chetpet
    { name: "Egmore Book Depot", phone: "9840009001", addr: "48, Whannels Rd, Egmore, Chennai 600008", lng: 80.2649, lat: 13.0726, area: "urban", zone: "Central Chennai" },
    { name: "Kilpauk Garden Shop", phone: "9841009002", addr: "33, Harrington Rd, Kilpauk, Chennai", lng: 80.2416, lat: 13.0802, area: "urban", zone: "Central Chennai" },
    { name: "Chetpet Florist", phone: "9842009003", addr: "12, Chetpet High Rd, Chennai 600031", lng: 80.2492, lat: 13.0717, area: "urban", zone: "Central Chennai" },
    { name: "Vepery Glass Works", phone: "9843009004", addr: "67, Vepery High Rd, Vepery, Chennai", lng: 80.2602, lat: 13.0813, area: "urban", zone: "North Chennai" },
    { name: "Kellys Kirana", phone: "9844009005", addr: "5, Kellys, Kilpauk, Chennai 600010", lng: 80.2421, lat: 13.0835, area: "urban", zone: "Central Chennai" },

    // Guindy / St Thomas Mount / Ekkatuthangal
    { name: "Guindy Metal Mart", phone: "9840010001", addr: "11, Industrial Estate, Guindy, Chennai", lng: 80.2097, lat: 13.0078, area: "industrial", zone: "South Chennai" },
    { name: "Ekkatuthangal Traders", phone: "9841010002", addr: "45, GST Rd, Ekkatuthangal, Chennai 600032", lng: 80.2162, lat: 13.0166, area: "urban", zone: "South Chennai" },
    { name: "St Thomas Mount Cafe", phone: "9842010003", addr: "3, Mount Rd, St Thomas Mount, Chennai", lng: 80.1737, lat: 12.9952, area: "suburban", zone: "South-West Chennai" },

    // Neelankarai / Injambakkam / Palavakkam
    { name: "Neelankarai Bakery", phone: "9840011001", addr: "22, ECR, Neelankarai, Chennai 600041", lng: 80.2665, lat: 12.9486, area: "suburban", zone: "South Chennai" },
    { name: "Injambakkam Resort Sup", phone: "9841011002", addr: "14, ECR, Injambakkam, Chennai 600115", lng: 80.2724, lat: 12.9335, area: "suburban", zone: "South Chennai" },
    { name: "Palavakkam Medicals", phone: "9842011003", addr: "8, Palavakkam, ECR, Chennai 600041", lng: 80.2699, lat: 12.9571, area: "suburban", zone: "South Chennai" },
    { name: "Okkiyam Medicals", phone: "9843011004", addr: "55, Okkiyam Thoraipakkam, Chennai", lng: 80.2344, lat: 12.9434, area: "urban", zone: "South Chennai" },

    // Virugambakkam / Vadapalani / Koyambedu
    { name: "Koyambedu Wholesale", phone: "9840012001", addr: "1, CMWSS Board Rd, Koyambedu, Chennai", lng: 80.1944, lat: 13.0693, area: "urban", zone: "West Chennai" },
    { name: "Vadapalani Hi-Tech", phone: "9841012002", addr: "34, Bharat Heavy Electricals, Vadapalani", lng: 80.2098, lat: 13.0538, area: "urban", zone: "West Chennai" },
    { name: "Virugambakkam Sweets", phone: "9842012003", addr: "67, 100 Feet Rd, Virugambakkam, Chennai", lng: 80.1912, lat: 13.0591, area: "urban", zone: "West Chennai" },
    { name: "Saligramam Auto", phone: "9843012004", addr: "11, Arcot Rd, Saligramam, Chennai 600093", lng: 80.2020, lat: 13.0556, area: "urban", zone: "West Chennai" },

    // New Chennai / Madhavaram / Manali
    { name: "Madhavaram Fresh Mart", phone: "9840013001", addr: "43, Madhavaram High Rd, Chennai 600060", lng: 80.2434, lat: 13.1488, area: "suburban", zone: "North Chennai" },
    { name: "Manali New Town Store", phone: "9841013002", addr: "22, Manali New Town, Chennai 600068", lng: 80.2549, lat: 13.1657, area: "suburban", zone: "North Chennai" },
    { name: "Wimco Nagar Grocery", phone: "9842013003", addr: "5, Wimco Nagar, Tiruvottiyur, Chennai", lng: 80.3006, lat: 13.1544, area: "urban", zone: "North Chennai" },

    // Mogappair / Padi / Villivakkam
    { name: "Mogappair Textiles", phone: "9840014001", addr: "23, Mogappair West, Chennai 600037", lng: 80.1664, lat: 13.0886, area: "urban", zone: "West Chennai" },
    { name: "Padi Kirana Store", phone: "9841014002", addr: "45, Padi, Chennai 600050", lng: 80.2103, lat: 13.1023, area: "urban", zone: "North Chennai" },
    { name: "Villivakkam Silks", phone: "9842014003", addr: "12, Villivakkam Main Rd, Chennai 600049", lng: 80.2180, lat: 13.1048, area: "urban", zone: "North Chennai" },
    { name: "Korattur Pharmacy", phone: "9843014004", addr: "7, Korattur, Chennai 600080", lng: 80.1892, lat: 13.1159, area: "urban", zone: "West Chennai" },

    // Perungalathur / Singaperumalkoil (South edge)
    { name: "Perungalathur Depot", phone: "9840015001", addr: "2, GST Road, Perungalathur, Chennai", lng: 80.0836, lat: 12.8873, area: "rural", zone: "South-West Chennai" },
    { name: "Urapakkam Fresh Mart", phone: "9841015002", addr: "34, Urapakkam Main Rd, Chennai", lng: 80.0985, lat: 12.8733, area: "rural", zone: "South-West Chennai" },

    // Tondiarpet / Washermenpet
    { name: "Tondiarpet Hardware", phone: "9840016001", addr: "18, Thambu Chetty St, Tondiarpet, Chennai", lng: 80.2919, lat: 13.1165, area: "urban", zone: "North Chennai" },
    { name: "Washermenpet Medicals", phone: "9841016002", addr: "33, NSK Salai, Washermenpet, Chennai", lng: 80.2862, lat: 13.1083, area: "urban", zone: "North Chennai" },

    // Besant Nagar / Foreshore Estate / Mandaveli
    { name: "Besant Nagar Cakes", phone: "9840017001", addr: "5, 6th Ave, Besant Nagar, Chennai 600090", lng: 80.2672, lat: 13.0008, area: "urban", zone: "South Chennai" },
    { name: "Foreshore Estate Mart", phone: "9841017002", addr: "12, Foreshore Estate, Chennai 600028", lng: 80.2813, lat: 13.0280, area: "urban", zone: "Central Chennai" },
    { name: "Mandaveli Fast Food", phone: "9842017003", addr: "45, Mandaveli, Chennai 600028", lng: 80.2722, lat: 13.0262, area: "urban", zone: "Central Chennai" },

    // Gopalapuram / Alwarpet / Nandanam
    { name: "Alwarpet Flowers", phone: "9840018001", addr: "7, Chamiers Rd, Alwarpet, Chennai 600018", lng: 80.2601, lat: 13.0241, area: "urban", zone: "Central Chennai" },
    { name: "Nandanam Silks", phone: "9841018002", addr: "22, Anna Salai, Nandanam, Chennai 600035", lng: 80.2444, lat: 13.0249, area: "urban", zone: "Central Chennai" },
    { name: "Gopalapuram Stationery", phone: "9842018003", addr: "14, Jawaharlal Nehru Rd, Gopalapuram", lng: 80.2564, lat: 13.0340, area: "urban", zone: "Central Chennai" },

    // Puzhal / Thiruvallur (extended North)
    { name: "Puzhal Fresh Produce", phone: "9840019001", addr: "8, Puzhal Village Rd, Chennai", lng: 80.2089, lat: 13.1804, area: "rural", zone: "North Chennai" },
    { name: "Thiruvallur Kirana", phone: "9841019002", addr: "55, Thiruvallur Town, Near Chennai", lng: 79.9067, lat: 13.1439, area: "rural", zone: "North-West Chennai" },

    // Maraimalai Nagar / Chengalpattu direction (SW edge)
    { name: "MNagar Auto Service", phone: "9840020001", addr: "3, Maraimalai Nagar, Near GST Rd, Chennai", lng: 80.0143, lat: 12.7836, area: "rural", zone: "South-West Chennai" },
    { name: "GST Road Traders", phone: "9841020002", addr: "100, GST Rd, Chengalpattu, Near Chennai", lng: 79.9745, lat: 12.7024, area: "rural", zone: "South-West Chennai" },
];

const seedData = async () => {
    try {
        console.log('Starting Database Seed...');

        // 1. CLEAR EXISTING DATA
        await Driver.deleteMany({});
        await Delivery.deleteMany({});
        await Route.deleteMany({});
        console.log('Old data cleared.');

        // 2. CREATE DRIVERS
        const drivers = await Driver.insertMany([
            {
                name: "Sanjay Kumar",
                email: "sanjay@test.com",
                vehicleType: "Truck",
                license: "TN-01-AB-1001",
                isAvailable: true,
                fuelLevel: 100,
                maxRange: 400,
                currentLocation: { type: 'Point', coordinates: [80.2707, 13.0827] },
                assignedZone: "North Chennai"
            },
            {
                name: "Priya Sharma",
                email: "priya@test.com",
                vehicleType: "Van",
                license: "TN-01-AB-2002",
                isAvailable: true,
                fuelLevel: 100,
                maxRange: 350,
                currentLocation: { type: 'Point', coordinates: [80.2707, 13.0827] },
                assignedZone: "South Chennai"
            },
            {
                name: "Amit Singh",
                email: "amit@test.com",
                vehicleType: "Bike",
                license: "TN-01-AB-3003",
                isAvailable: true,
                fuelLevel: 100,
                maxRange: 200,
                currentLocation: { type: 'Point', coordinates: [80.2707, 13.0827] },
                assignedZone: "West Chennai"
            },
            {
                name: "Kavitha Rajan",
                email: "kavitha@test.com",
                vehicleType: "EV",
                license: "TN-01-AB-4004",
                isAvailable: true,
                fuelLevel: 100,
                maxRange: 300,
                currentLocation: { type: 'Point', coordinates: [80.2707, 13.0827] },
                assignedZone: "Central Chennai"
            },
            {
                name: "Rajeev Pillai",
                email: "rajeev@test.com",
                vehicleType: "Truck",
                license: "TN-01-AB-5005",
                isAvailable: true,
                fuelLevel: 100,
                maxRange: 400,
                currentLocation: { type: 'Point', coordinates: [80.2707, 13.0827] },
                assignedZone: "South-West Chennai"
            }
        ]);
        console.log(`Added ${drivers.length} Drivers`);

        // 3. CREATE 100 DELIVERIES
        const deliveryDocs = chennaiDeliveries.map((d, i) => ({
            customerName: d.name,
            customerPhone: d.phone,
            pickupLocation: { type: 'Point', coordinates: [d.lng, d.lat] },
            dropoffLocation: { type: 'Point', coordinates: [d.lng, d.lat] },
            fullAddress: d.addr,
            status: 'pending',
            area: d.area,
            zone: d.zone,
            weight: parseFloat((Math.random() * 20 + 0.5).toFixed(1)),
            size: ['small', 'medium', 'large'][i % 3],
            deadline: [240, 360, 480, 600, 720][i % 5],
            emergency: i % 15 === 0,  // Every 15th delivery is emergency
            items: ['Package'],
            cost: Math.floor(Math.random() * 450 + 50),
        }));

        const deliveries = await Delivery.insertMany(deliveryDocs);
        console.log(`Added ${deliveries.length} Deliveries across Chennai`);
        console.log('Seeding Complete! 🚛');

    } catch (error) {
        console.error('Seeding Error:', error);
    }
};

module.exports = seedData;