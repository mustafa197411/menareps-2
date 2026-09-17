import React, { useState, useMemo, useEffect } from "react";
import { MapPin, Users, Search, Plus, Map as MapIcon, Edit, Trash, X, ChevronDown, CheckSquare, Square, Info, UserPlus, Filter, RefreshCw } from "lucide-react";
import { collection, onSnapshot, doc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { User } from "../../types";

interface TerritoryRecord {
  id: string;
  name: string;
  description: string;
  status: "Active" | "Inactive";
}

interface AssignedUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface TerritoryManagementProps {
  lang: "en" | "ar";
  currentUser?: User | null;
  users?: User[];
}

export default function TerritoryManagement({ lang, currentUser, users = [] }: TerritoryManagementProps) {
  const isRtl = lang === "ar";

  // Initial records from screenshot 4
  const [territories, setTerritories] = useState<TerritoryRecord[]>([]);

  // Dynamic Territory-to-Areas State (Spatial mapping as in Screenshot 1)
  const [territoryAreas, setTerritoryAreas] = useState<Record<string, string[]>>({});

  // Dynamic Territory-to-Users State (Staff roster as in Screenshot 2)
  const [assignedUsers, setAssignedUsers] = useState<Record<string, AssignedUser[]>>({});

  // Form states
  const [countries, setCountries] = useState<any[]>([]);
  const [districts, setDistricts] = useState<any[]>([]);
  const [cities, setCities] = useState<any[]>([]);
  const [areas, setAreas] = useState<any[]>([]);

  useEffect(() => {
    if (!currentUser?.id) {
      console.info("TERRITORY QUERY POSTPONED: No authenticated currentUser state available");
      return;
    }

    // Dynamic runtime logging as requested
    console.log("Firebase projectId:", db.app?.options?.projectId || "unknown");
    console.log("Firebase databaseId:", (db as any)._databaseId?.database || "unknown");
    console.log("The exact collection path used when reading territories:", collection(db, "territories").path);
    console.log("The exact collection path used when creating a territory:", collection(db, "territories").path);

    console.info("TERRITORY QUERY", { path: "territories", userId: currentUser.id, userRole: currentUser.role });
    const unsubTerritories = onSnapshot(collection(db, "territories"), (snap) => {
      if (snap.empty) { setTerritories([]); setTerritoryAreas({}); setAssignedUsers({}); return; }

      const docs = snap.docs.map(doc => {
        const data = doc.data();
        const id = doc.id;
        const name = data.name || data.territoryName || "";
        const status = data.status || "Active";
        
        let description = data.description || "";
        if (!description && data.countryName) {
          description = `area: ${data.countryName} > ${data.districtName} > ${data.cityName} > ${data.areaName}`;
        }
        
        const areasList = data.areas || (data.areaName ? [data.areaName] : []);
        const assigned = data.assignedUsers || [];
        
        return {
          id,
          name,
          description,
          status,
          areas: areasList,
          assignedUsers: assigned,
          isDeleted: data.isDeleted || false
        };
      });

      const activeDocs = docs.filter(d => !d.isDeleted);
      setTerritories(activeDocs.map(t => ({ id: t.id, name: t.name, description: t.description, status: t.status as any })));

      const areasMap: Record<string, string[]> = {};
      const usersMap: Record<string, AssignedUser[]> = {};
      
      activeDocs.forEach(t => {
        areasMap[t.id] = t.areas;
        usersMap[t.id] = t.assignedUsers;
      });
      
      setTerritoryAreas(areasMap);
      setAssignedUsers(usersMap);
      console.info("TERRITORY RESULT", activeDocs);
    }, (err) => {
      console.error("TERRITORY ERROR", err);
      console.error("Error loading territories:", err);
      console.error("FirebaseError:", {
        code: (err as any).code,
        message: err.message,
        customData: (err as any).customData,
        stack: err.stack
      });
    });

    return () => unsubTerritories();
  }, [currentUser?.id, currentUser?.role]);

  useEffect(() => {
    if (!currentUser?.id) {
      console.info("GEOGRAPHY LISTENERS POSTPONED: No authenticated currentUser state available");
      return;
    }

    const unsubCountries = onSnapshot(collection(db, "countries"), (snap) => {
      const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setCountries(docs);
    }, (err) => {
      console.error(err);
      setCountries([]);
    });

    const unsubDistricts = onSnapshot(collection(db, "districts"), (snap) => {
      const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setDistricts(docs);
    }, (err) => {
      console.error(err);
      setDistricts([]);
    });

    const unsubCities = onSnapshot(collection(db, "cities"), (snap) => {
      const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setCities(docs);
    }, (err) => {
      console.error(err);
      setCities([]);
    });

    const unsubAreas = onSnapshot(collection(db, "areas"), (snap) => {
      const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAreas(docs);
    }, (err) => {
      console.error(err);
      setAreas([]);
    });

    return () => {
      unsubCountries();
      unsubDistricts();
      unsubCities();
      unsubAreas();
    };
  }, [currentUser?.id]);

  const allGlobalAreas = useMemo(() => {
    if (areas && areas.length > 0) {
      return Array.from(new Set(areas.map(a => a.name))).sort();
    }
    return [];
  }, [areas]);

  const allGlobalUsers: AssignedUser[] = users.map(user => ({
    id: user.id || user.uid || "",
    name: user.name,
    email: user.email,
    role: String(user.role)
  })).filter(user => Boolean(user.id));

  // Search and Select States
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  
  // Advanced Filter States
  const [selectedStaffId, setSelectedStaffId] = useState<string>("");
  const [selectedCity, setSelectedCity] = useState<string>("");
  const [selectedDistrict, setSelectedDistrict] = useState<string>("");
  const [selectedArea, setSelectedArea] = useState<string>("");

  // Modals Visibility
  const [isOpen, setIsOpen] = useState(false); // Create/Edit modal
  const [editId, setEditId] = useState<string | null>(null);
  
  // Spatial maps modal (Manage Areas)
  const [activeAreasTerritoryId, setActiveAreasTerritoryId] = useState<string | null>(null);
  const [areaSearchQuery, setAreaSearchQuery] = useState("");

  // Staff roster modal (Assign Users)
  const [activeUsersTerritoryId, setActiveUsersTerritoryId] = useState<string | null>(null);
  const [userSearchQuery, setUserSearchQuery] = useState("");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [formCountry, setFormCountry] = useState("");
  const [formDistrict, setFormDistrict] = useState("");
  const [formCity, setFormCity] = useState("");
  const [formAreas, setFormAreas] = useState<string[]>([]);

  // Helper to parse territory description (e.g. "area: Libya > East > Al Jufra > Hun")
  const parseDescription = (desc: string) => {
    const clean = desc.replace(/^area:\s*/i, "").trim();
    const parts = clean.split(/[→>]/).map(p => p.trim());
    const country = parts[0] || "";
    const district = parts[1] || "";
    const city = parts[2] || "";
    const area = parts[3] || "";
    return { country, district, city, area };
  };

  // Dynamically extract distinct options from data to keep filters clean and adaptive
  const availableDistricts = useMemo(() => {
    const districtsSet = new Set<string>();
    territories.forEach(t => {
      const parsed = parseDescription(t.description);
      if (parsed.district) districtsSet.add(parsed.district);
    });
    return Array.from(districtsSet).sort();
  }, [territories]);

  const availableCities = useMemo(() => {
    const citiesSet = new Set<string>();
    territories.forEach(t => {
      const parsed = parseDescription(t.description);
      if (parsed.city) citiesSet.add(parsed.city);
    });
    return Array.from(citiesSet).sort();
  }, [territories]);

  const availableAreas = useMemo(() => {
    const areasSet = new Set<string>();
    territories.forEach(t => {
      const parsed = parseDescription(t.description);
      if (parsed.area) areasSet.add(parsed.area);
    });
    (Object.values(territoryAreas) as string[][]).forEach(areas => {
      areas.forEach(a => areasSet.add(a));
    });
    allGlobalAreas.forEach(a => areasSet.add(a));
    return Array.from(areasSet).sort();
  }, [territories, territoryAreas, allGlobalAreas]);

  const availableStaff = useMemo(() => {
    const staffMap = new Map<string, AssignedUser>();
    allGlobalUsers.forEach(u => staffMap.set(u.id, u));
    (Object.values(assignedUsers) as AssignedUser[][]).forEach(users => {
      users.forEach(u => staffMap.set(u.id, u));
    });
    return Array.from(staffMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [assignedUsers]);

  const filteredTerritories = useMemo(() => {
    return territories.filter(t => {
      // 1. Text Search query
      const matchesSearch = 
        t.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        t.description.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;

      // Parse current territory description for exact structure matching
      const parsed = parseDescription(t.description);

      // 2. City Filter
      if (selectedCity) {
        const isCityMatch = parsed.city.toLowerCase() === selectedCity.toLowerCase() || 
                            t.description.toLowerCase().includes(selectedCity.toLowerCase());
        if (!isCityMatch) return false;
      }

      // 3. District Filter
      if (selectedDistrict) {
        const isDistrictMatch = parsed.district.toLowerCase() === selectedDistrict.toLowerCase() ||
                                t.description.toLowerCase().includes(selectedDistrict.toLowerCase());
        if (!isDistrictMatch) return false;
      }

      // 4. Area Filter
      if (selectedArea) {
        const areasList = territoryAreas[t.id] || [];
        const hasArea = areasList.some(a => a.toLowerCase() === selectedArea.toLowerCase()) ||
                        parsed.area.toLowerCase() === selectedArea.toLowerCase() ||
                        t.description.toLowerCase().includes(selectedArea.toLowerCase());
        if (!hasArea) return false;
      }

      // 5. Team Member (Staff) Filter
      if (selectedStaffId) {
        const staffList = assignedUsers[t.id] || [];
        const hasStaff = staffList.some(u => u.id === selectedStaffId);
        if (!hasStaff) return false;
      }

      return true;
    });
  }, [territories, searchQuery, selectedStaffId, selectedCity, selectedDistrict, selectedArea, territoryAreas, assignedUsers]);

  // Spatial Maps helper computed variables
  const activeAreasTerritory = useMemo(() => {
    return territories.find(t => t.id === activeAreasTerritoryId);
  }, [territories, activeAreasTerritoryId]);

  const currentAreas = useMemo(() => {
    if (!activeAreasTerritoryId) return [];
    return territoryAreas[activeAreasTerritoryId] || [];
  }, [territoryAreas, activeAreasTerritoryId]);

  const filteredAvailableAreas = useMemo(() => {
    return allGlobalAreas.filter(area => 
      !currentAreas.includes(area) && 
      area.toLowerCase().includes(areaSearchQuery.toLowerCase())
    );
  }, [currentAreas, areaSearchQuery]);

  // Staff Roster helper computed variables
  const activeUsersTerritory = useMemo(() => {
    return territories.find(t => t.id === activeUsersTerritoryId);
  }, [territories, activeUsersTerritoryId]);

  const currentAssignedUsers = useMemo(() => {
    if (!activeUsersTerritoryId) return [];
    return assignedUsers[activeUsersTerritoryId] || [];
  }, [assignedUsers, activeUsersTerritoryId]);

  const filteredAvailableUsers = useMemo(() => {
    return allGlobalUsers.filter(user => 
      !currentAssignedUsers.some(u => u.id === user.id) && 
      (user.name.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
       user.email.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
       user.role.toLowerCase().includes(userSearchQuery.toLowerCase()))
    );
  }, [currentAssignedUsers, userSearchQuery]);

  // Core Actions
  const handleSelectAll = () => {
    const allSelected = filteredTerritories.length > 0 && filteredTerritories.every(t => selectedIds[t.id]);
    const nextSelected: Record<string, boolean> = {};
    if (!allSelected) {
      filteredTerritories.forEach(t => {
        nextSelected[t.id] = true;
      });
    }
    setSelectedIds(nextSelected);
  };

  const handleSelectRow = (id: string) => {
    setSelectedIds(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const handleOpenCreate = () => {
    setEditId(null);
    setName("");
    setDescription("");
    setFormCountry("C-LIB");
    setFormDistrict("");
    setFormCity("");
    setFormAreas([]);
    setIsOpen(true);
  };

  const handleOpenEdit = (record: TerritoryRecord) => {
    setEditId(record.id);
    setName(record.name);
    setDescription(record.description);
    
    // Parse description e.g., "area: Libya > East > Al Jufra > Hun"
    const parsed = parseDescription(record.description);
    
    const countryObj = countries.find(c => c.name.toLowerCase() === parsed.country.toLowerCase()) || countries[0];
    setFormCountry(countryObj ? countryObj.id : "");
    
    const districtObj = districts.find(d => d.name.toLowerCase().includes(parsed.district.toLowerCase()) && d.countryId === (countryObj ? countryObj.id : ""));
    if (districtObj) {
      setFormDistrict(districtObj.id);
      const cityObj = cities.find(c => c.name.toLowerCase().includes(parsed.city.toLowerCase()) && c.districtId === districtObj.id);
      if (cityObj) {
        setFormCity(cityObj.id);
      } else {
        setFormCity("");
      }
    } else {
      setFormDistrict("");
      setFormCity("");
    }
    
    const currentList = territoryAreas[record.id] || [];
    setFormAreas(currentList.length > 0 ? currentList : (parsed.area ? parsed.area.split(",").map(a => a.trim()) : []));
    setIsOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || formAreas.length === 0 || !formCity || !formDistrict || !formCountry) {
      alert(isRtl ? "يرجى تعبئة اسم الإقليم واختيار نطاق واحد على الأقل" : "Please complete territory name and select at least one area.");
      return;
    }

    const countryObj = countries.find(c => c.id === formCountry);
    if (!countryObj) { alert(isRtl ? "يجب اختيار دولة صالحة" : "A canonical country is required."); return; }
    const countryName = countryObj.name;

    const districtObj = districts.find(d => d.id === formDistrict);
    if (!districtObj) { alert(isRtl ? "يجب اختيار منطقة صالحة" : "A canonical district is required."); return; }
    const districtName = districtObj.name;

    const cityObj = cities.find(c => c.id === formCity);
    if (!cityObj) { alert(isRtl ? "يجب اختيار مدينة صالحة" : "A canonical city is required."); return; }
    const cityName = cityObj.name;

    const generatedDescription = `area: ${countryName} → ${districtName} → ${cityName} → ${formAreas.join(", ")}`;

    try {
      if (editId) {
        // Edit existing
        const tDocRef = doc(db, "territories", editId);
        const objectToWrite = {
          id: editId,
          name: name.trim(),
          description: generatedDescription,
          status: "Active",
          areas: formAreas,
          assignedUsers: assignedUsers[editId] || [],
          isDeleted: false,
          updatedAt: new Date().toISOString()
        };
        console.log("Before addDoc(), print the complete object being written:", objectToWrite);
        await setDoc(tDocRef, objectToWrite, { merge: true });
      } else {
        // Create new
        const newId = `TM-${Date.now()}`;
        const tDocRef = doc(db, "territories", newId);
        const objectToWrite = {
          id: newId,
          name: name.trim(),
          description: generatedDescription,
          status: "Active",
          areas: formAreas,
          assignedUsers: [],
          isDeleted: false,
          createdAt: new Date().toISOString()
        };
        console.log("Before addDoc(), print the complete object being written:", objectToWrite);
        await setDoc(tDocRef, objectToWrite);
      }
      setIsOpen(false);
      setName("");
      setFormAreas([]);
    } catch (error) {
      console.error("Error saving territory:", error);
      const err = error as any;
      console.error("FirebaseError:", {
        code: err.code,
        message: err.message,
        customData: err.customData,
        stack: err.stack
      });
      alert("Error saving territory: " + error);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm(isRtl ? "هل أنت متأكد من حذف هذا النطاق الميداني؟" : "Are you sure you want to delete this territory zone?")) {
      try {
        const docRef = doc(db, "territories", id);
        await updateDoc(docRef, { isDeleted: true });
      } catch (error) {
        console.error("Error deleting territory:", error);
        alert("Error deleting territory: " + error);
      }
    }
  };

  // Spatial Maps Area management triggers
  const handleRemoveArea = async (area: string) => {
    if (!activeAreasTerritoryId) return;
    const updatedAreas = (territoryAreas[activeAreasTerritoryId] || []).filter(a => a !== area);
    try {
      const docRef = doc(db, "territories", activeAreasTerritoryId);
      await updateDoc(docRef, { areas: updatedAreas });
    } catch (error) {
      console.error("Error removing area:", error);
    }
  };

  const handleAddArea = async (area: string) => {
    if (!activeAreasTerritoryId) return;
    const current = territoryAreas[activeAreasTerritoryId] || [];
    if (!current.includes(area)) {
      const updatedAreas = [...current, area];
      try {
        const docRef = doc(db, "territories", activeAreasTerritoryId);
        await updateDoc(docRef, { areas: updatedAreas });
      } catch (error) {
        console.error("Error adding area:", error);
      }
    }
  };

  // Staff Roster management triggers
  const handleRemoveUser = async (userId: string) => {
    if (!activeUsersTerritoryId) return;
    const updatedUsers = (assignedUsers[activeUsersTerritoryId] || []).filter(u => u.id !== userId);
    try {
      const docRef = doc(db, "territories", activeUsersTerritoryId);
      await updateDoc(docRef, { assignedUsers: updatedUsers });
    } catch (error) {
      console.error("Error removing user:", error);
    }
  };

  const handleAddUser = async (user: AssignedUser) => {
    if (!activeUsersTerritoryId) return;
    const current = assignedUsers[activeUsersTerritoryId] || [];
    if (!current.some(u => u.id === user.id)) {
      const updatedUsers = [...current, user];
      try {
        const docRef = doc(db, "territories", activeUsersTerritoryId);
        await updateDoc(docRef, { assignedUsers: updatedUsers });
      } catch (error) {
        console.error("Error adding user:", error);
      }
    }
  };

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 flex items-center gap-2">
            <MapPin className="h-6 w-6 text-blue-600" />
            {isRtl ? "إدارة وتوزيع الأقاليم" : "Territory Management"}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {isRtl ? "إنشاء، تعديل، وتوزيع الأقاليم الجغرافية المعينة للمندوبين" : "Create, edit, and manage territories and their assignments"}
          </p>
        </div>

        <div>
          <button
            onClick={handleOpenCreate}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-lg shadow-sm hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            {isRtl ? "إنشاء إقليم جديد" : "Create Territory"}
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-2 border-b border-gray-50">
          <div className="flex items-center gap-2">
            <Filter className="h-4.5 w-4.5 text-blue-600" />
            <span className="text-sm font-bold text-gray-800">
              {isRtl ? "تصفية وفلترة الأقاليم المتقدمة" : "Advanced Territory Filters"}
            </span>
          </div>
          
          {/* Quick Clear filters */}
          {(selectedStaffId || selectedCity || selectedDistrict || selectedArea || searchQuery) && (
            <button
              onClick={() => {
                setSelectedStaffId("");
                setSelectedCity("");
                setSelectedDistrict("");
                setSelectedArea("");
                setSearchQuery("");
              }}
              className="inline-flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700 font-semibold bg-red-50 hover:bg-red-100/70 px-2.5 py-1 rounded-lg transition-all"
            >
              <RefreshCw className="h-3 w-3" />
              {isRtl ? "إعادة ضبط الفلاتر" : "Reset Filters"}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
          {/* 1. Text Search query */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-gray-500 block uppercase tracking-wider">
              {isRtl ? "البحث بالاسم والوصف" : "Search Name & Desc"}
            </label>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={isRtl ? "البحث عن الأقاليم..." : "Search territories..."}
                className="w-full text-xs pl-8 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium"
              />
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" />
            </div>
          </div>

          {/* 2. District Filter */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-gray-500 block uppercase tracking-wider">
              {isRtl ? "المنطقة الجغرافية (District)" : "District"}
            </label>
            <div className="relative">
              <select
                value={selectedDistrict}
                onChange={(e) => setSelectedDistrict(e.target.value)}
                className="w-full text-xs pl-3 pr-8 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium appearance-none"
              >
                <option value="">{isRtl ? "الكل" : "All Districts"}</option>
                {availableDistricts.map(dist => (
                  <option key={dist} value={dist}>{dist}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
            </div>
          </div>

          {/* 3. City Filter */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-gray-500 block uppercase tracking-wider">
              {isRtl ? "المدينة (City)" : "City"}
            </label>
            <div className="relative">
              <select
                value={selectedCity}
                onChange={(e) => setSelectedCity(e.target.value)}
                className="w-full text-xs pl-3 pr-8 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium appearance-none"
              >
                <option value="">{isRtl ? "الكل" : "All Cities"}</option>
                {availableCities.map(city => (
                  <option key={city} value={city}>{city}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
            </div>
          </div>

          {/* 4. Area Filter */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-gray-500 block uppercase tracking-wider">
              {isRtl ? "المحلة / المنطقة (Area)" : "Area"}
            </label>
            <div className="relative">
              <select
                value={selectedArea}
                onChange={(e) => setSelectedArea(e.target.value)}
                className="w-full text-xs pl-3 pr-8 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium appearance-none"
              >
                <option value="">{isRtl ? "الكل" : "All Areas"}</option>
                {availableAreas.map(area => (
                  <option key={area} value={area}>{area}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
            </div>
          </div>

          {/* 5. Team Member (Staff) Filter */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-gray-500 block uppercase tracking-wider">
              {isRtl ? "عضو الفريق المعين" : "Team Member"}
            </label>
            <div className="relative">
              <select
                value={selectedStaffId}
                onChange={(e) => setSelectedStaffId(e.target.value)}
                className="w-full text-xs pl-3 pr-8 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium appearance-none"
              >
                <option value="">{isRtl ? "الكل" : "All Staff Members"}</option>
                {availableStaff.map(staff => (
                  <option key={staff.id} value={staff.id}>
                    {staff.name} ({staff.role})
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Results helper info */}
        <div className="text-xs text-gray-400 flex items-center justify-between">
          <span>
            {isRtl 
              ? `تم العثور على ${filteredTerritories.length} من إجمالي ${territories.length} أقاليم` 
              : `Showing ${filteredTerritories.length} of ${territories.length} territories`
            }
          </span>
          {(selectedStaffId || selectedCity || selectedDistrict || selectedArea || searchQuery) && (
            <span className="text-blue-600 font-semibold bg-blue-50 px-2 py-0.5 rounded text-[10px]">
              {isRtl ? "الفلاتر النشطة" : "Filters active"}
            </span>
          )}
        </div>
      </div>

      {/* Territories Table List */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        {/* Desktop View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100">
                <th className="p-4 w-12 text-center">
                  <button 
                    onClick={handleSelectAll}
                    className="text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
                  >
                    {filteredTerritories.length > 0 && filteredTerritories.every(t => selectedIds[t.id]) ? (
                      <CheckSquare className="h-4 w-4 text-blue-600" />
                    ) : (
                      <Square className="h-4 w-4" />
                    )}
                  </button>
                </th>
                <th className="p-4">{isRtl ? "اسم الإقليم" : "Name"}</th>
                <th className="p-4">{isRtl ? "الوصف الجغرافي" : "Description"}</th>
                <th className="p-4">{isRtl ? "المناطق المخصصة" : "Assigned Areas"}</th>
                <th className="p-4">{isRtl ? "طاقم العمل الميداني" : "Field Staff"}</th>
                <th className="p-4">{isRtl ? "الحالة" : "Status"}</th>
                <th className="p-4 text-right pr-6">{isRtl ? "الإجراءات" : "Action"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredTerritories.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-500">
                    <Info className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                    {isRtl ? "لم يتم العثور على أقاليم معينة" : "No territories found matching criteria."}
                  </td>
                </tr>
              ) : (
                filteredTerritories.map((t) => {
                  const areasList = territoryAreas[t.id] || [];
                  const staffList = assignedUsers[t.id] || [];
                  return (
                    <tr 
                      key={t.id}
                      className={`hover:bg-gray-50/70 transition-colors ${selectedIds[t.id] ? "bg-blue-50/20" : ""}`}
                    >
                      <td className="p-4 text-center">
                        <button 
                          onClick={() => handleSelectRow(t.id)}
                          className="text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
                        >
                          {selectedIds[t.id] ? (
                            <CheckSquare className="h-4 w-4 text-blue-600" />
                          ) : (
                            <Square className="h-4 w-4" />
                          )}
                        </button>
                      </td>
                      <td className="p-4 font-semibold text-gray-900 flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-blue-500" />
                        {t.name}
                      </td>
                      <td className="p-4 font-mono text-xs text-gray-500">
                        {t.description}
                      </td>
                      <td className="p-4">
                        <div className="flex flex-wrap gap-1">
                          {areasList.length === 0 ? (
                            <span className="text-xs text-gray-400 italic">{isRtl ? "لا يوجد" : "None"}</span>
                          ) : (
                            areasList.map(a => (
                              <span key={a} className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700 font-medium">
                                {a}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="text-xs font-semibold text-gray-700">
                          {staffList.length} {isRtl ? "أعضاء" : "members"}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-100">
                          {t.status}
                        </span>
                      </td>
                      <td className="p-4 text-right pr-6 space-x-2">
                        <button 
                          onClick={() => {
                            setActiveAreasTerritoryId(t.id);
                            setAreaSearchQuery("");
                          }}
                          className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-all inline-flex items-center justify-center cursor-pointer"
                          title={isRtl ? "إدارة المناطق" : "Manage Areas"}
                        >
                          <MapIcon className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => {
                            setActiveUsersTerritoryId(t.id);
                            setUserSearchQuery("");
                          }}
                          className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-all inline-flex items-center justify-center cursor-pointer"
                          title={isRtl ? "تعيين المستخدمين" : "Assign Users"}
                        >
                          <Users className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => handleOpenEdit(t)}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-all inline-flex items-center justify-center cursor-pointer"
                          title={isRtl ? "تعديل" : "Edit Details"}
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => handleDelete(t.id)}
                          className="p-1.5 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded-md transition-all inline-flex items-center justify-center cursor-pointer"
                          title={isRtl ? "حذف" : "Remove Territory"}
                        >
                          <Trash className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile View */}
        <div className="block md:hidden divide-y divide-gray-100">
          {filteredTerritories.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-xs">
              <Info className="h-8 w-8 text-gray-300 mx-auto mb-2" />
              {isRtl ? "لم يتم العثور على أقاليم معينة" : "No territories found matching criteria."}
            </div>
          ) : (
            filteredTerritories.map((t) => {
              const areasList = territoryAreas[t.id] || [];
              const staffList = assignedUsers[t.id] || [];
              return (
                <div 
                  key={t.id} 
                  className={`p-4 space-y-3 transition-colors ${selectedIds[t.id] ? "bg-blue-50/10" : ""} ${isRtl ? "text-right" : "text-left"}`}
                >
                  <div className={`flex items-start justify-between gap-2 ${isRtl ? "flex-row-reverse" : "flex-row"}`}>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => handleSelectRow(t.id)}
                        className="text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
                      >
                        {selectedIds[t.id] ? (
                          <CheckSquare className="h-4.5 w-4.5 text-blue-600" />
                        ) : (
                          <Square className="h-4.5 w-4.5" />
                        )}
                      </button>
                      <div className="flex flex-col">
                        <span className="font-semibold text-gray-900 text-xs flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                          {t.name}
                        </span>
                        <span className="text-gray-400 text-[10px] font-mono mt-0.5">{t.description}</span>
                      </div>
                    </div>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-100 shrink-0">
                      {t.status}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[10px] uppercase font-bold text-gray-400 block">{isRtl ? "المناطق المخصصة" : "Assigned Areas"}:</span>
                    <div className="flex flex-wrap gap-1">
                      {areasList.length === 0 ? (
                        <span className="text-[10px] text-gray-400 italic">{isRtl ? "لا يوجد مناطق" : "No areas"}</span>
                      ) : (
                        areasList.map(a => (
                          <span key={a} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-700 font-medium">
                            {a}
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  <div className={`flex items-center justify-between pt-2 border-t border-gray-50 ${isRtl ? "flex-row-reverse" : "flex-row"}`}>
                    <span className="text-[11px] text-gray-500 font-medium">
                      {isRtl ? "طاقم العمل الميداني: " : "Field Staff: "}
                      <span className="font-bold text-gray-800">{staffList.length}</span>
                    </span>
                    
                    <div className="flex items-center gap-1.5">
                      <button 
                        onClick={() => {
                          setActiveAreasTerritoryId(t.id);
                          setAreaSearchQuery("");
                        }}
                        className="p-1.5 text-gray-600 hover:bg-gray-100 border border-gray-100 rounded-md transition-all inline-flex items-center justify-center cursor-pointer bg-white"
                        title={isRtl ? "إدارة المناطق" : "Manage Areas"}
                      >
                        <MapIcon className="h-3.5 w-3.5" />
                      </button>
                      <button 
                        onClick={() => {
                          setActiveUsersTerritoryId(t.id);
                          setUserSearchQuery("");
                        }}
                        className="p-1.5 text-gray-600 hover:bg-gray-100 border border-gray-100 rounded-md transition-all inline-flex items-center justify-center cursor-pointer bg-white"
                        title={isRtl ? "تعيين المستخدمين" : "Assign Users"}
                      >
                        <Users className="h-3.5 w-3.5" />
                      </button>
                      <button 
                        onClick={() => handleOpenEdit(t)}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 border border-blue-50 rounded-md transition-all inline-flex items-center justify-center cursor-pointer bg-white"
                        title={isRtl ? "تعديل" : "Edit Details"}
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </button>
                      <button 
                        onClick={() => handleDelete(t.id)}
                        className="p-1.5 text-red-500 hover:bg-red-50 border border-red-50 rounded-md transition-all inline-flex items-center justify-center cursor-pointer bg-white"
                        title={isRtl ? "حذف" : "Remove Territory"}
                      >
                        <Trash className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 1. Spatial mapping modal (Manage Areas) matches Screenshot 1 */}
      {activeAreasTerritoryId && activeAreasTerritory && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full border border-gray-100 animate-in fade-in zoom-in duration-200 overflow-hidden">
            
            {/* Header */}
            <div className="flex items-start justify-between p-5 border-b border-gray-100 bg-white">
              <div>
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <MapIcon className="h-5 w-5 text-gray-700" />
                  {isRtl ? `إدارة المناطق - ${activeAreasTerritory.name}` : `Manage Areas - ${activeAreasTerritory.name}`}
                </h3>
                <p className="text-xs text-gray-500 mt-1">
                  {isRtl ? "أضف أو أزل مناطق من هذا النطاق الميداني." : "Add or remove areas from this territory."}
                </p>
              </div>
              <button 
                onClick={() => setActiveAreasTerritoryId(null)}
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Content Body */}
            <div className="p-5 space-y-5">
              
              {/* Current Areas box */}
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-gray-700 block">
                  {isRtl ? `المناطق الحالية (${currentAreas.length})` : `Current Areas (${currentAreas.length})`}
                </span>
                <div className="border border-gray-200 rounded-lg p-3 min-h-[90px] flex flex-wrap gap-2 items-start bg-gray-50/20 shadow-inner">
                  {currentAreas.length === 0 ? (
                    <span className="text-xs text-gray-400 italic">
                      {isRtl ? "لا توجد مناطق مخصصة حالياً" : "No areas assigned yet"}
                    </span>
                  ) : (
                    currentAreas.map(area => (
                      <span 
                        key={area}
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-semibold rounded-lg transition-all border border-gray-200"
                      >
                        {area}
                        <button 
                          type="button" 
                          onClick={() => handleRemoveArea(area)}
                          className="text-gray-400 hover:text-gray-900 p-0.5 rounded transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ))
                  )}
                </div>
              </div>

              {/* Add Areas box */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-gray-700 block">
                  {isRtl ? "إضافة مناطق" : "Add Areas"}
                </span>
                
                {/* Search Bar */}
                <div className="relative">
                  <input
                    type="text"
                    value={areaSearchQuery}
                    onChange={(e) => setAreaSearchQuery(e.target.value)}
                    placeholder={isRtl ? "البحث عن مناطق متاحة..." : "Search available areas..."}
                    className="w-full text-sm pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
                  />
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                </div>

                {/* Scroll List */}
                <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto divide-y divide-gray-100 shadow-sm bg-white">
                  {filteredAvailableAreas.length === 0 ? (
                    <p className="p-4 text-xs text-gray-400 text-center italic">
                      {isRtl ? "لا توجد مناطق مطابقة للبحث" : "No available areas matching search"}
                    </p>
                  ) : (
                    filteredAvailableAreas.map(area => (
                      <div key={area} className="flex items-center justify-between p-3 hover:bg-gray-50/50 transition-colors">
                        <span className="text-xs font-medium text-gray-800">{area}</span>
                        <button
                          type="button"
                          onClick={() => handleAddArea(area)}
                          className="p-1 text-blue-600 hover:bg-blue-50 rounded-md transition-colors inline-flex items-center justify-center"
                          title={isRtl ? "إضافة المنطقة" : "Add Area"}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>

            {/* Footer Done button */}
            <div className="flex items-center justify-end p-4 border-t border-gray-100 bg-gray-50/50">
              <button
                type="button"
                onClick={() => setActiveAreasTerritoryId(null)}
                className="px-5 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shadow-sm transition-colors"
              >
                {isRtl ? "تم" : "Done"}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* 2. Staff Roster modal (Assign Users) matches Screenshot 2 */}
      {activeUsersTerritoryId && activeUsersTerritory && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full border border-gray-100 animate-in fade-in zoom-in duration-200 overflow-hidden">
            
            {/* Header */}
            <div className="flex items-start justify-between p-5 border-b border-gray-100 bg-white">
              <div>
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <Users className="h-5 w-5 text-gray-700" />
                  {isRtl ? `تعيين الكادر الميداني - ${activeUsersTerritory.name}` : `Assign Users - ${activeUsersTerritory.name}`}
                </h3>
                <p className="text-xs text-gray-500 mt-1">
                  {isRtl ? "إدارة وتنسيق تعيين المندوبين والمشرفين لهذا الإقليم." : "Manage user assignments for this territory."}
                </p>
              </div>
              <button 
                onClick={() => setActiveUsersTerritoryId(null)}
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Content Body */}
            <div className="p-5 space-y-5">
              
              {/* Assigned Users Card block */}
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-gray-700 block">
                  {isRtl ? `المستخدمون المعينون (${currentAssignedUsers.length})` : `Assigned Users (${currentAssignedUsers.length})`}
                </span>
                
                <div className="border border-gray-200 rounded-lg p-3 bg-gray-50/30 max-h-48 overflow-y-auto space-y-2 shadow-inner">
                  {currentAssignedUsers.length === 0 ? (
                    <p className="text-xs text-gray-400 italic text-center p-4 bg-white border border-dashed rounded-lg border-gray-200">
                      {isRtl ? "لم يتم تعيين مستخدمين حالياً" : "No users assigned to this territory"}
                    </p>
                  ) : (
                    currentAssignedUsers.map(user => {
                      const initials = user.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
                      return (
                        <div key={user.id} className="flex items-center justify-between p-2.5 bg-white border border-gray-100 rounded-lg shadow-sm hover:shadow-md transition-all">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8.5 h-8.5 rounded-full bg-blue-50 text-blue-700 text-xs font-bold flex items-center justify-center border border-blue-100 shadow-sm min-w-[34px] min-h-[34px]">
                              {initials}
                            </div>
                            <div>
                              <h5 className="text-xs font-bold text-gray-900 leading-tight">{user.name}</h5>
                              <p className="text-[10px] text-gray-400 font-mono leading-none mt-0.5">{user.email}</p>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center px-2 py-0.5 rounded bg-gray-150 text-gray-600 text-[10px] font-mono font-semibold">
                              {user.role}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRemoveUser(user.id)}
                              className="p-1 text-gray-300 hover:text-red-500 rounded hover:bg-red-50 transition-colors"
                              title={isRtl ? "إلغاء التعيين" : "Remove user"}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Available Users Box */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-gray-700 block">
                  {isRtl ? "المستخدمون المتاحون للتعيين" : "Available Users"}
                </span>
                
                {/* Search Bar */}
                <div className="relative">
                  <input
                    type="text"
                    value={userSearchQuery}
                    onChange={(e) => setUserSearchQuery(e.target.value)}
                    placeholder={isRtl ? "البحث عن مستخدمين متاحين..." : "Search available users..."}
                    className="w-full text-sm pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
                  />
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                </div>

                {/* Available Users Scroll List */}
                <div className="border border-gray-200 rounded-lg max-h-52 overflow-y-auto divide-y divide-gray-100 shadow-inner bg-white">
                  {filteredAvailableUsers.length === 0 ? (
                    <p className="p-4 text-xs text-gray-400 text-center italic">
                      {isRtl ? "لا يوجد مستخدمون متاحون مطابقون للبحث" : "No matching available users"}
                    </p>
                  ) : (
                    filteredAvailableUsers.map(user => {
                      const initials = user.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
                      return (
                        <div key={user.id} className="flex items-center justify-between p-3 hover:bg-gray-50/50 transition-colors">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8.5 h-8.5 rounded-full bg-gray-50 text-gray-600 text-xs font-bold flex items-center justify-center border border-gray-200 shadow-inner min-w-[34px] min-h-[34px]">
                              {initials}
                            </div>
                            <div>
                              <h5 className="text-xs font-bold text-gray-800 leading-tight">{user.name}</h5>
                              <p className="text-[10px] text-gray-400 font-mono leading-none mt-0.5">{user.email}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <span className="inline-flex items-center px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px] font-mono font-semibold">
                              {user.role}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleAddUser(user)}
                              className="p-1 text-blue-600 hover:bg-blue-50 rounded-md transition-colors inline-flex items-center justify-center"
                              title={isRtl ? "تعيين المستخدم" : "Assign User"}
                            >
                              <UserPlus className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

            </div>

            {/* Footer Done button */}
            <div className="flex items-center justify-end p-4 border-t border-gray-100 bg-gray-50/50">
              <button
                type="button"
                onClick={() => setActiveUsersTerritoryId(null)}
                className="px-5 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shadow-sm transition-colors"
              >
                {isRtl ? "تم" : "Done"}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Create / Edit Dialog Modal matching screenshot 6 */}
      {isOpen && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full border border-gray-100 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900">
                {editId ? (isRtl ? "تعديل بيانات الإقليم" : "Edit Territory") : (isRtl ? "إنشاء إقليم جديد" : "Create Territory")}
              </h3>
              <button 
                onClick={() => setIsOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <p className="text-sm text-gray-500">
                {isRtl ? "أضف إقليماً جغرافياً لتنظيم مناطق التغطية الميدانية للمناديب." : "Add a new territory to organize your coverage areas."}
              </p>

              {/* Territory Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700">
                  {isRtl ? "اسم الإقليم الميداني *" : "Territory Name *"}
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Benghazi East Zone"
                  className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/25 focus:border-blue-500 transition-all"
                />
              </div>

              {/* 1. Select Country */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700">
                  {isRtl ? "1. الدولة *" : "1. Country *"}
                </label>
                <select
                  required
                  value={formCountry}
                  onChange={(e) => {
                    setFormCountry(e.target.value);
                    setFormDistrict("");
                    setFormCity("");
                    setFormAreas([]);
                  }}
                  className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/25 focus:border-blue-500 transition-all bg-white"
                >
                  <option value="">{isRtl ? "اختر الدولة" : "Select Country"}</option>
                  {countries.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {/* 2. Select District */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700">
                  {isRtl ? "2. المنطقة الجغرافية *" : "2. District *"}
                </label>
                <select
                  required
                  disabled={!formCountry}
                  value={formDistrict}
                  onChange={(e) => {
                    setFormDistrict(e.target.value);
                    setFormCity("");
                    setFormAreas([]);
                  }}
                  className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/25 focus:border-blue-500 transition-all bg-white disabled:bg-gray-50 disabled:opacity-50"
                >
                  <option value="">{isRtl ? "اختر المنطقة" : "Select District"}</option>
                  {districts.filter(d => d.countryId === formCountry).map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              {/* 3. Select City */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700">
                  {isRtl ? "3. المدينة / الحاضرة *" : "3. City *"}
                </label>
                <select
                  required
                  disabled={!formDistrict}
                  value={formCity}
                  onChange={(e) => {
                    setFormCity(e.target.value);
                    setFormAreas([]);
                  }}
                  className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/25 focus:border-blue-500 transition-all bg-white disabled:bg-gray-50 disabled:opacity-50"
                >
                  <option value="">{isRtl ? "اختر المدينة" : "Select City"}</option>
                  {cities.filter(c => c.districtId === formDistrict).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {/* 4. Select Areas */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700">
                  {isRtl ? "4. اختر محلة أو أكثر من النطاق الجغرافي المعني *" : "4. Select One or More Areas *"}
                </label>
                <div className="border border-gray-200 rounded-lg p-3 max-h-40 overflow-y-auto space-y-2 bg-slate-50/50">
                  {areas.filter(a => a.cityId === formCity).length === 0 ? (
                    <p className="text-xs text-gray-400 italic text-center p-2">
                      {isRtl ? "الرجاء اختيار المدينة أولاً لعرض المحلات المتاحة" : "Please select City to see available areas."}
                    </p>
                  ) : (
                    areas.filter(a => a.cityId === formCity).map(area => {
                      const isChecked = formAreas.includes(area.name);
                      return (
                        <label key={area.id} className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer hover:text-gray-900">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              if (isChecked) {
                                setFormAreas(formAreas.filter(name => name !== area.name));
                              } else {
                                setFormAreas([...formAreas, area.name]);
                              }
                            }}
                            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 accent-blue-600"
                          />
                          <span>{area.name}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="px-4 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  {isRtl ? "إلغاء" : "Cancel"}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 shadow-sm"
                >
                  {editId ? (isRtl ? "حفظ التعديلات" : "Save Changes") : (isRtl ? "إنشاء" : "Create")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
